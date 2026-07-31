// 구글 광고 레퍼런스 수집 시스템 — Azure 리소스 (PROJECT.md §2 매핑, TODO Phase 4)
// 배포: az deployment group create -g rg-adref-prod -f infra/bicep/main.bicep \
//        -p pgAdminPassword=<비밀번호>
// 리소스: Storage(Queue·Blob) + PostgreSQL Flexible(B1ms) + Key Vault + Function App(소비)
//         + App Service(B1, 대시보드) + Application Insights

@description('리소스 이름 접두사')
param baseName string = 'adref'

@description('리전 (Korea Central)')
param location string = resourceGroup().location

@description('PostgreSQL 관리자 비밀번호')
@secure()
param pgAdminPassword string

@description('PostgreSQL 관리자 계정명')
param pgAdminLogin string = 'adrefadmin'

@description('DB 접근을 허용할 사내/개발 IP (비우면 Azure 서비스만)')
param allowedClientIp string = ''

var suffix = uniqueString(resourceGroup().id)
var storageName = toLower('${baseName}st${suffix}')

// ── Storage (Functions 런타임 + new-ads/collect-requests 큐 + thumbnails Blob) ──
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
  }
}

// ── Log Analytics + Application Insights ──
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${baseName}-logs'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${baseName}-insights'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

// ── PostgreSQL Flexible Server (B1ms, 32GB) ──
resource pg 'Microsoft.DBforPostgreSQL/flexibleServers@2023-12-01-preview' = {
  name: '${baseName}-pg-${suffix}'
  location: location
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    version: '16'
    administratorLogin: pgAdminLogin
    administratorLoginPassword: pgAdminPassword
    storage: { storageSizeGB: 32 }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: { mode: 'Disabled' }
  }
}

resource pgDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-12-01-preview' = {
  parent: pg
  name: 'adref'
}

// Azure 내부 서비스(Functions/App Service) 접근 허용
resource pgFirewallAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2023-12-01-preview' = {
  parent: pg
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource pgFirewallClient 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2023-12-01-preview' = if (allowedClientIp != '') {
  parent: pg
  name: 'AllowClientIp'
  properties: {
    startIpAddress: allowedClientIp
    endIpAddress: allowedClientIp
  }
}

// ── Key Vault (RBAC 모드 — 시크릿은 배포 후 az keyvault secret set) ──
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: '${baseName}-kv-${suffix}'
  location: location
  properties: {
    tenantId: tenant().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enabledForTemplateDeployment: true
  }
}

// ── Function App (Linux 소비 플랜, Node 20) — 수집기 ──
resource funcPlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${baseName}-func-plan'
  location: location
  kind: 'functionapp'
  sku: { name: 'Y1', tier: 'Dynamic' }
  properties: { reserved: true } // Linux
}

var storageConn = 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'
var pgConn = 'postgres://${pgAdminLogin}:${pgAdminPassword}@${pg.properties.fullyQualifiedDomainName}:5432/adref?sslmode=require'

resource funcApp 'Microsoft.Web/sites@2023-12-01' = {
  name: '${baseName}-func-${suffix}'
  location: location
  kind: 'functionapp,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: funcPlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|20'
      appSettings: [
        { name: 'AzureWebJobsStorage', value: storageConn }
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }
        { name: 'WEBSITE_CONTENTAZUREFILECONNECTIONSTRING', value: storageConn }
        { name: 'WEBSITE_CONTENTSHARE', value: toLower('${baseName}-func-${suffix}') }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
        { name: 'DATABASE_URL', value: pgConn }
        // 시크릿은 Key Vault 참조로 교체 예정 (배포 후 시크릿 등록 + 역할 부여)
        { name: 'SERPAPI_KEY', value: '@Microsoft.KeyVault(VaultName=${keyVault.name};SecretName=serpapi-key)' }
        { name: 'YOUTUBE_API_KEY', value: '@Microsoft.KeyVault(VaultName=${keyVault.name};SecretName=youtube-api-key)' }
        { name: 'ADS_SOURCE', value: 'serpapi' } // Azure IP 는 크롤 차단 가능성 높음 → 기본 serpapi
        { name: 'COLLECT_FORMATS', value: 'all' }
        { name: 'CRAWL_THROTTLE_MS', value: '1500' }
        { name: 'CRAWL_RUN_LIMIT', value: '500' }
        { name: 'CRAWL_RUN_PAUSE_MS', value: '600000' }
        { name: 'AD_QUEUE_NAME', value: 'new-ads' }
        { name: 'COLLECT_QUEUE_NAME', value: 'collect-requests' }
        { name: 'BLOB_CONTAINER', value: 'thumbnails' }
        { name: 'QUOTA_MONTHLY_BUDGET', value: '5000' }
        { name: 'QUOTA_THROTTLE_PCT', value: '0.8' }
        { name: 'AD_LIST_CRON', value: '0 0 0,12 * * *' }
        { name: 'VIEW_COUNT_CRON', value: '0 0 3 * * *' }
      ]
    }
  }
}

// ── App Service (B1 Linux, Node 20) — 대시보드 ──
resource webPlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${baseName}-web-plan'
  location: location
  kind: 'linux'
  sku: { name: 'B1', tier: 'Basic' }
  properties: { reserved: true }
}

resource webApp 'Microsoft.Web/sites@2023-12-01' = {
  name: '${baseName}-web-${suffix}'
  location: location
  kind: 'app,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: webPlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|20-lts'
      appCommandLine: 'node packages/dashboard/server.js' // Next.js standalone (모노레포 경로)
      appSettings: [
        { name: 'DATABASE_URL', value: pgConn }
        { name: 'COLLECT_FORMATS', value: 'all' }
        { name: 'AUTH_MODE', value: 'mock' } // 자체 회원가입/세션 사용 — Easy Auth 도입 시 entra
        { name: 'HOSTNAME', value: '0.0.0.0' }
        { name: 'FUNCTIONS_BASE_URL', value: 'https://${funcApp.properties.defaultHostName}/api' }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
      ]
    }
  }
}

// ── Key Vault Secrets User 역할 부여 (Functions/App Service Managed Identity) ──
var kvSecretsUserRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')

resource funcKvRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, funcApp.id, kvSecretsUserRole)
  scope: keyVault
  properties: {
    roleDefinitionId: kvSecretsUserRole
    principalId: funcApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

output functionAppName string = funcApp.name
output functionAppUrl string = 'https://${funcApp.properties.defaultHostName}'
output webAppName string = webApp.name
output webAppUrl string = 'https://${webApp.properties.defaultHostName}'
output pgHost string = pg.properties.fullyQualifiedDomainName
output keyVaultName string = keyVault.name
output storageAccountName string = storage.name

// Azure Functions v4 — 트리거 등록. 각 파일이 app.timer/app.storageQueue 로 자기 등록한다.
import './functions/adListCollector.js';
import './functions/adDetailCollector.js';
import './functions/viewCountCollector.js';
import './functions/collectForCompetitorHttp.js';
import './functions/collectRequestProcessor.js';

import { env } from './env';

export interface User {
  email: string;
  name: string;
}

/**
 * 현재 사용자. 로컬(AUTH_MODE=mock)은 목 사용자, Azure(entra)는 App Service Easy Auth 가
 * 주입하는 헤더(x-ms-client-principal-name)를 읽는다. 배포 시 인증 코드 변경 최소화.
 */
export function currentUser(headers?: Headers): User {
  if (env().AUTH_MODE === 'entra') {
    const email = headers?.get('x-ms-client-principal-name') ?? 'unknown@shaperon.com';
    return { email, name: email.split('@')[0] ?? email };
  }
  return { email: 'dev@local', name: '개발자(mock)' };
}

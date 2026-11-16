import AsyncStorage from '@react-native-async-storage/async-storage';

const TOKEN_KEY = 'knittinglog/auth-tokens';

/** 서버가 발급한 세션 토큰. access는 15분, refresh는 30일 동안 유효하다 */
export interface Tokens {
  access: string;
  refresh: string;
}

let cached: Tokens | null | undefined;

/** 저장된 토큰. 없으면 null */
export async function getTokens(): Promise<Tokens | null> {
  if (cached === undefined) {
    try {
      const json = await AsyncStorage.getItem(TOKEN_KEY);
      cached = json ? (JSON.parse(json) as Tokens) : null;
    } catch {
      cached = null;
    }
  }
  return cached;
}

/** 로그인·토큰 갱신 성공 시 저장, 로그아웃 시 null */
export async function setTokens(tokens: Tokens | null) {
  cached = tokens;
  try {
    if (tokens) await AsyncStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
    else await AsyncStorage.removeItem(TOKEN_KEY);
  } catch {
    // 저장에 실패해도 이번 실행 동안은 메모리의 토큰으로 동작한다
  }
}

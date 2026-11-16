import AsyncStorage from '@react-native-async-storage/async-storage';

const TOKEN_KEY = 'knittinglog/auth-token';

let cached: string | null | undefined;

/** 저장된 인증 토큰. 없으면 null */
export async function getToken() {
  if (cached === undefined) {
    cached = await AsyncStorage.getItem(TOKEN_KEY).catch(() => null);
  }
  return cached;
}

/** 로그인 성공 시 토큰 저장, 로그아웃 시 null */
export async function setToken(token: string | null) {
  cached = token;
  try {
    if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
    else await AsyncStorage.removeItem(TOKEN_KEY);
  } catch {
    // 저장에 실패해도 이번 실행 동안은 메모리의 토큰으로 동작한다
  }
}

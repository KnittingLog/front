import Constants from 'expo-constants';
import { Platform } from 'react-native';

const DEFAULT_API_URL = 'http://localhost:8000';

/** 요청이 이 시간 안에 끝나지 않으면 끊는다 */
export const API_TIMEOUT_MS = 10_000;

const LOCAL_HOSTS = /^(https?:\/\/)(localhost|127\.0\.0\.1)(?=[:/]|$)/;

/**
 * 폰·에뮬레이터에서 localhost는 개발 PC가 아니라 기기 자신을 가리킨다.
 * 개발 중에는 localhost를 실제로 닿을 수 있는 주소로 바꿔 준다.
 */
function resolveLocalhost(url: string) {
  if (!__DEV__ || Platform.OS === 'web' || !LOCAL_HOSTS.test(url)) return url;

  // Metro 개발 서버 주소(예: 192.168.0.5:8081) = 개발 PC의 LAN IP
  const devHost = Constants.expoConfig?.hostUri?.split(':')[0];
  if (devHost && devHost !== 'localhost' && devHost !== '127.0.0.1') {
    return url.replace(LOCAL_HOSTS, `$1${devHost}`);
  }
  // Android 에뮬레이터에서 호스트 PC로 가는 주소
  if (Platform.OS === 'android') return url.replace(LOCAL_HOSTS, '$110.0.2.2');
  return url;
}

/** 백엔드 주소 (끝의 / 없음). EXPO_PUBLIC_API_URL로 바꿀 수 있다 */
export const API_BASE_URL = resolveLocalhost(
  (process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL).replace(/\/+$/, ''),
);

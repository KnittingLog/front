/** 로그인 아이디·계정 ID 공통 규칙 (서버 Security.identifier와 같다): 영문 소문자, 숫자, _ . 3~32자, 처음과 끝은 영문·숫자 */
export const ID_RE = /^(?!.*\.\.)[a-z0-9][a-z0-9_.]{1,30}[a-z0-9]$/;
export const ID_RULE = '영문 소문자, 숫자, _ . 만 사용해 3~32자로 입력해 주세요. 처음과 끝은 영문이나 숫자여야 해요.';
/** 서버 비밀번호 규칙 (Security.password): 15~128자 */
export const PASSWORD_MIN = 15;
export const PASSWORD_MAX = 128;
export const normalizeId = (s: string) => s.trim().toLowerCase().replace(/^@/, '');

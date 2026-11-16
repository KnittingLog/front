/**
 * 백엔드(back/packages/api/src/structures) 응답·요청 형태.
 * 서버는 snake_case를 쓰고, 화면에서 쓰는 형태(src/types.ts)로는 store에서 바꾼다.
 */

export type Visibility = 'public' | 'friends' | 'private';
export type WorkspaceStatus = 'active' | 'paused' | 'done';
export type RequestStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled';
export type ReasonCode = 'spam' | 'abuse' | 'inappropriate' | 'privacy' | 'other';
/** 기록 반응으로 허용된 코드 (RecordProvider.react) */
export type EmojiCode = 'like' | 'heart' | 'clap' | 'celebrate' | 'wow';

export interface User {
  id: string;
  handle: string;
  nickname: string;
  biography: string | null;
  profile_photo_object_id?: string | null;
  visibility: Visibility;
}

export interface Session {
  user: User;
  access_token: string;
  refresh_token: string;
}

export interface RegistrationSession extends Session {
  /** 비밀번호를 잊었을 때 쓰는 복구 코드. 가입 때 한 번만 내려온다 */
  recovery_code: string;
}

export interface Registration {
  login_id: string;
  handle: string;
  nickname: string;
  password: string;
  policy_document_ids: string[];
}

export interface PolicyDocument {
  id: string;
  code: string;
  version: string;
  title: string;
  body: string;
  language: string;
  effective_at: string;
  requires_reconsent: boolean;
}

export interface AccountUpdate {
  handle?: string;
  nickname?: string;
  biography?: string | null;
  visibility?: Visibility;
}

export interface Statistics {
  total_duration_seconds: number;
}

export interface Project {
  id: string;
  owner_user_id: string;
  name: string;
  cover_photo_object_id: string | null;
}

export interface ProjectMembership {
  id: string;
  project_id: string;
  user_id: string;
  left_at: string | null;
}

export interface Workspace {
  id: string;
  project_id: string;
  owner_user_id: string;
  status: WorkspaceStatus;
  yarn_notes: string | null;
  needle_notes: string | null;
  ended_at: string | null;
  /** 작업 공간이 바뀔 때마다 1씩 오른다. 카운터·타이머 명령의 expected_version으로 보낸다 */
  version: number;
}

export interface Invitation {
  id: string;
  project_id: string;
  recipient_id: string;
  status: RequestStatus;
}

/** 나가기·추방 결과: 작업 공간이 새 개인 프로젝트(to_project_id)로 옮겨진다 */
export interface Transfer {
  id: string;
  workspace_id: string;
  from_project_id: string;
  to_project_id: string;
  workspace_version: number;
}

export interface Counter {
  id: string;
  workspace_id: string;
  name: string;
  value: number;
  target_value: number | null;
  is_visible: boolean;
  sort_order: number;
  version: number;
}

export interface Timer {
  id: string;
  workspace_id: string;
  owner_user_id: string;
  status: 'running' | 'paused' | 'stopped';
  started_at: string | null;
  accumulated_seconds: number;
  version: number;
}

export interface KnitRecord {
  id: string;
  workspace_id: string;
  author_id: string;
  author_name: string;
  source: 'manual' | 'timer';
  body: string | null;
  duration_seconds: number;
  recorded_at: string;
}

export interface RecordComment {
  id: string;
  record_id: string;
  author_id: string;
  author_name: string;
  body: string;
}

export interface RecordReaction {
  id: string;
  record_id: string;
  user_id: string;
  emoji_code: EmojiCode;
}

export interface Post {
  id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
}

export interface Feed {
  items: Post[];
  next_cursor: string | null;
}

export interface PostComment {
  id: string;
  post_id: string;
  author_id: string;
  author_name: string;
  body: string;
}

export interface FriendRequest {
  id: string;
  sender_id: string;
  recipient_id: string;
  status: RequestStatus;
}

export interface ReportInput {
  reason_code: ReasonCode;
  detail?: string | null;
  /** 유저 신고와 게시글 신고 중 하나만 지정한다 */
  target_user_id?: string;
  post_id?: string;
  block_target?: boolean;
}

/** 낙관적 잠금이 걸린 명령의 공통 입력 */
export interface Command {
  operation_id: string;
  expected_version: number;
}

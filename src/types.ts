/** 개인별 프로젝트 상태: 진행중 / 보관(잠시 중단) / 종료(본인 기록 종료) */
export type MemberStatus = 'active' | 'paused' | 'done';

/** 프로필 공개 범위: 전체 공개 / 친구 공개 / 비공개 (함께 하는 프로젝트 안에서는 항상 보임) */
export type ProfileVisibility = 'public' | 'friends' | 'private';

export interface User {
  id: string;
  name: string;
  /** 계정 ID (@handle) — 친구 찾기·표시에 쓰고, 바꿀 수 있다 */
  handle: string;
  bio: string;
  color: string;
  visibility: ProfileVisibility;
}

/** 프로젝트 자체는 이름·대표 사진·방장만 가진다. 상태·실·기록은 멤버 개인 소유 */
export interface Project {
  id: string;
  title: string;
  ownerId: string;
  /** 대표 사진의 서버 저장 객체 id */
  coverObjectId?: string;
  /** 내려받은 대표 사진 (data URI). 서버는 사진을 올린 사람에게만 내려준다 */
  coverUri?: string;
}

export interface Counter {
  id: string;
  label: string;
  value: number;
  /** 목표 단수 (0이면 목표 없음) */
  max: number;
  /** 작업바에 표시 */
  visible: boolean;
  /** 이 기기에서 마지막으로 값을 바꾼 시각 (ISO). 서버는 알려 주지 않는다 */
  updatedAt?: string;
}

/** 프로젝트에 대한 한 사람의 참여 정보 (개인 소유). 서버의 작업 공간(workspace)에 해당한다 */
export interface Membership {
  projectId: string;
  userId: string;
  /** 서버 작업 공간 id — 기록·카운터·타이머가 여기에 달린다 */
  workspaceId: string;
  /** 작업 공간 변경 번호 (낙관적 잠금) */
  version: number;
  status: MemberStatus;
  /** 첫 기록 시각 (ISO). 기록이 없으면 비어 있다 */
  startedAt?: string;
  /** 종료로 바꾼 날 (ISO) */
  endedAt?: string;
  yarn: string;
  needle: string;
  /** 내 작업 공간만 채워진다 (프로젝트 상세를 열 때 불러온다) */
  counters: Counter[];
}

export interface FriendRequest {
  id: string;
  from: string;
  to: string;
}

export interface ProjectInvite {
  id: string;
  projectId: string;
  to: string;
}

export interface Comment {
  id: string;
  authorId: string;
  text: string;
  /** 게시글 댓글·기록 댓글 모두 서버가 작성 시각을 주지 않아, 방금 쓴 댓글에만 있다 */
  createdAt?: string;
}

export interface Reaction {
  emoji: string;
  userIds: string[];
}

export interface KnitLog {
  id: string;
  /** 내가 참여하지 않은 프로젝트의 기록(프로필에서 본 기록)이면 '' */
  projectId: string;
  workspaceId: string;
  authorId: string;
  /** 기록 시각 (ISO) */
  startedAt: string;
  durationSec: number;
  text: string;
  reactions: Reaction[];
  comments: Comment[];
  /** 반응·댓글을 서버에서 불러왔는지 */
  socialLoaded?: boolean;
}

/** 커뮤니티 게시글 (작품 자랑) */
export interface Post {
  id: string;
  authorId: string;
  text: string;
  comments: Comment[];
  /** 댓글을 서버에서 불러왔는지 */
  commentsLoaded?: boolean;
  createdAt: string;
}

/** 서버 신고 사유 코드 */
export type ReportReason = 'spam' | 'abuse' | 'inappropriate' | 'privacy' | 'other';

export interface TimerState {
  /** 실행 중이면 마지막으로 시작한 시각(ms), 멈춰 있으면 null */
  runningSince: number | null;
  accumulatedMs: number;
  /** 이 기기에서 처음 시작한 시각(ms). 모르면 null */
  firstStartedAt: number | null;
}

/** 다른 사람 프로필 화면에 쓰는 요약 (서버 통계) */
export interface ProfileStats {
  /** 기록을 볼 수 있는지 (공개 범위에 막히면 false) */
  canViewLogs: boolean;
  totalSec: number;
}

/** 서버에서 받아 온 데이터의 메모리 캐시 */
export interface RawState {
  /** 로그인한 유저 id */
  session: string | null;
  /** 첫 데이터를 불러오는 중 */
  loading: boolean;
  users: Record<string, User>;
  friendIds: string[];
  /** 대기 중인 친구 요청 (받은 것 + 보낸 것) */
  friendRequests: FriendRequest[];
  /** 내가 받은 초대 + 이 기기에서 내가 보낸 초대 */
  invites: ProjectInvite[];
  projects: Project[];
  memberships: Membership[];
  logs: KnitLog[];
  posts: Post[];
  /** 피드 다음 페이지 커서. 더 없으면 null */
  feedCursor: string | null;
  /** 내가 좋아요한 게시글. 서버가 좋아요 목록을 주지 않아 기기에 기억해 둔다 */
  likedPostIds: string[];
  /** 내가 차단한 유저 */
  blockedIds: string[];
  /** projectId → 내 타이머 */
  timers: Record<string, TimerState>;
  /** userId → 프로필 요약 */
  profiles: Record<string, ProfileStats>;
}

/** 화면에서 쓰는 상태: 로그인한 유저 기준으로 계산된 값이 붙는다 */
export interface AppState extends RawState {
  meId: string;
  incomingRequestIds: string[];
  outgoingRequestIds: string[];
  /** 내가 받은 프로젝트 초대 */
  incomingInvites: ProjectInvite[];
  /** 서로 안 보이는 유저. 서버는 나를 차단한 사람을 알려 주지 않으므로 내가 차단한 유저와 같다 */
  hiddenIds: string[];
}

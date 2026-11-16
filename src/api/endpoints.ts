/**
 * 백엔드 REST API 호출 모음. 경로는 back/packages/backend/src/controllers 와 1:1로 맞춘다.
 * 모든 경로 앞에는 /api/v1 이 붙는다 (config.ts).
 */
import { api } from './client';
import type * as dto from './dto';

const id = encodeURIComponent;

// ── 인증 (AuthController) ──
export const register = (input: dto.Registration) =>
  api.post<dto.RegistrationSession>('/auth/register', input, { auth: false, timeoutMs: 30_000 });
export const login = (login_id: string, password: string) =>
  api.post<dto.Session>('/auth/login', { login_id, password }, { auth: false, timeoutMs: 30_000 });
export const logout = (refresh_token: string) => api.post<void>('/auth/logout', { refresh_token });

// ── 정책 문서 (PolicyController) ──
export const policyDocuments = () => api.get<dto.PolicyDocument[]>('/policy-documents', { auth: false });
export const agreePolicies = (policy_document_ids: string[]) =>
  api.post('/users/me/policy-consents', { policy_document_ids });

// ── 계정 (AccountController) ──
export const me = () => api.get<dto.User>('/users/me');
export const updateMe = (input: dto.AccountUpdate) => api.patch<dto.User>('/users/me', input);
export const searchUsers = (query: string) => api.get<dto.User[]>('/users', { query: { query } });
export const user = (userId: string) => api.get<dto.User>(`/users/${id(userId)}`);
export const myRecords = () => api.get<dto.KnitRecord[]>('/users/me/records');
export const userRecords = (userId: string) => api.get<dto.KnitRecord[]>(`/users/${id(userId)}/records`);
export const userStatistics = (userId: string) => api.get<dto.Statistics>(`/users/${id(userId)}/statistics`);
export const userPosts = (userId: string) => api.get<dto.Post[]>(`/users/${id(userId)}/posts`);

// ── 친구·차단 (FriendController, FriendRequestController, BlockController) ──
export const friends = () => api.get<dto.User[]>('/friends');
export const unfriend = (userId: string) => api.delete<void>(`/friends/${id(userId)}`);
export const friendRequests = (direction: 'sent' | 'received') =>
  api.get<dto.FriendRequest[]>('/friend-requests', { query: { direction, status: 'pending' } });
/** 상대가 먼저 요청해 둔 상태라면 바로 친구가 되고 status가 accepted로 온다 */
export const sendFriendRequest = (recipient_id: string) => api.post<dto.FriendRequest>('/friend-requests', { recipient_id });
export const acceptFriendRequest = (requestId: string) => api.post<dto.FriendRequest>(`/friend-requests/${id(requestId)}/accept`);
export const rejectFriendRequest = (requestId: string) => api.post<dto.FriendRequest>(`/friend-requests/${id(requestId)}/reject`);
export const cancelFriendRequest = (requestId: string) => api.delete<void>(`/friend-requests/${id(requestId)}`);
export const blocks = () => api.get<dto.User[]>('/blocks');
export const block = (blocked_id: string) => api.post<{ blocked_id: string }>('/blocks', { blocked_id });
export const unblock = (userId: string) => api.delete<void>(`/blocks/${id(userId)}`);

// ── 프로젝트 (ProjectController, ProjectInvitationController) ──
export const projects = () => api.get<dto.Project[]>('/projects');
export const project = (projectId: string) => api.get<dto.Project>(`/projects/${id(projectId)}`);
export const createProject = (input: { name: string; cover_photo_object_id?: string | null; invitee_user_ids?: string[] }) =>
  api.post<dto.Project>('/projects', input);
export const updateProject = (projectId: string, input: { name?: string; cover_photo_object_id?: string | null }) =>
  api.patch<dto.Project>(`/projects/${id(projectId)}`, input);
export const deleteProject = (projectId: string) => api.delete<void>(`/projects/${id(projectId)}`);
export const projectMemberships = (projectId: string) => api.get<dto.ProjectMembership[]>(`/projects/${id(projectId)}/memberships`);
export const projectWorkspaces = (projectId: string) => api.get<dto.Workspace[]>(`/projects/${id(projectId)}/workspaces`);
export const transferOwner = (projectId: string, owner_user_id: string) =>
  api.patch<dto.Project>(`/projects/${id(projectId)}/owner`, { owner_user_id });
export const invite = (projectId: string, recipient_id: string) =>
  api.post<dto.Invitation>(`/projects/${id(projectId)}/invitations`, { recipient_id });
export const leaveProject = (projectId: string, input: dto.Command & { workspace_id: string }) =>
  api.post<dto.Transfer>(`/projects/${id(projectId)}/leave`, input);
export const kickMember = (projectId: string, userId: string, input: dto.Command & { workspace_id: string }) =>
  api.post<dto.Transfer>(`/projects/${id(projectId)}/members/${id(userId)}/kick`, input);
/** 내가 받은 대기 중인 초대 */
export const invitations = () => api.get<dto.Invitation[]>('/project-invitations');
export const acceptInvitation = (invitationId: string) =>
  api.post<dto.ProjectMembership>(`/project-invitations/${id(invitationId)}/accept`);
export const rejectInvitation = (invitationId: string) => api.post<void>(`/project-invitations/${id(invitationId)}/reject`);
export const cancelInvitation = (invitationId: string) => api.delete<void>(`/project-invitations/${id(invitationId)}`);

// ── 작업 공간·카운터·타이머 (WorkspaceController, CounterController) ──
export const workspace = (workspaceId: string) => api.get<dto.Workspace>(`/workspaces/${id(workspaceId)}`);
export const updateWorkspace = (
  workspaceId: string,
  input: { status?: dto.WorkspaceStatus; yarn_notes?: string | null; needle_notes?: string | null },
) => api.patch<dto.Workspace>(`/workspaces/${id(workspaceId)}`, input);
export const counters = (workspaceId: string) => api.get<dto.Counter[]>(`/workspaces/${id(workspaceId)}/counters`);
export const createCounter = (
  workspaceId: string,
  input: dto.Command & { name: string; target_value: number | null; is_visible: boolean },
) => api.post<dto.Counter>(`/workspaces/${id(workspaceId)}/counters`, input);
export const orderCounters = (workspaceId: string, input: dto.Command & { counter_ids: string[] }) =>
  api.patch<dto.Counter[]>(`/workspaces/${id(workspaceId)}/counters/order`, input);
export const updateCounter = (
  counterId: string,
  input: dto.Command & { name?: string; value?: number; target_value?: number | null; is_visible?: boolean },
) => api.patch<dto.Counter>(`/counters/${id(counterId)}`, input);
export const adjustCounter = (counterId: string, input: { operation_id: string; delta: 1 | -1 }) =>
  api.post<dto.Counter>(`/counters/${id(counterId)}/adjust`, input);
export const deleteCounter = (counterId: string, input: dto.Command) => api.delete<void>(`/counters/${id(counterId)}`, input);
/** 진행 중(running·paused)인 내 타이머. 없으면 null */
export const timer = (workspaceId: string) => api.get<dto.Timer | null>(`/workspaces/${id(workspaceId)}/timer`);
export const timerCommand = (workspaceId: string, kind: 'start' | 'pause' | 'resume', input: dto.Command) =>
  api.post<dto.Timer>(`/workspaces/${id(workspaceId)}/timer/${kind}`, input);
/** 타이머를 끝내고 그 시간만큼의 기록을 만든다 */
export const stopTimer = (workspaceId: string, input: dto.Command & { body?: string | null }) =>
  api.post<dto.KnitRecord>(`/workspaces/${id(workspaceId)}/timer/stop`, input);

// ── 기록 (WorkspaceController, RecordController, RecordCommentController) ──
export const workspaceRecords = (workspaceId: string) => api.get<dto.KnitRecord[]>(`/workspaces/${id(workspaceId)}/records`);
export const createRecord = (
  workspaceId: string,
  input: { operation_id: string; source: 'manual' | 'timer'; body: string | null; duration_seconds: number; recorded_at: string },
) => api.post<dto.KnitRecord>(`/workspaces/${id(workspaceId)}/records`, input);
export const updateRecord = (recordId: string, input: { body?: string | null; duration_seconds?: number }) =>
  api.patch<dto.KnitRecord>(`/records/${id(recordId)}`, input);
export const deleteRecord = (recordId: string) => api.delete<void>(`/records/${id(recordId)}`);
export const recordComments = (recordId: string) => api.get<dto.RecordComment[]>(`/records/${id(recordId)}/comments`);
export const createRecordComment = (recordId: string, body: string) =>
  api.post<dto.RecordComment>(`/records/${id(recordId)}/comments`, { body });
export const deleteRecordComment = (commentId: string) => api.delete<void>(`/record-comments/${id(commentId)}`);
export const recordReactions = (recordId: string) => api.get<dto.RecordReaction[]>(`/records/${id(recordId)}/reactions`);
export const react = (recordId: string, emoji: dto.EmojiCode) =>
  api.put<dto.RecordReaction>(`/records/${id(recordId)}/reactions/${emoji}`);
export const unreact = (recordId: string, emoji: dto.EmojiCode) => api.delete<void>(`/records/${id(recordId)}/reactions/${emoji}`);

// ── 피드 (CommunityController) ──
export const feed = (cursor?: string, limit = 30) => api.get<dto.Feed>('/feed', { query: { limit, cursor } });
export const createPost = (body: string) => api.post<dto.Post>('/posts', { body });
export const deletePost = (postId: string) => api.delete<void>(`/posts/${id(postId)}`);
export const postComments = (postId: string) => api.get<dto.PostComment[]>(`/posts/${id(postId)}/comments`);
export const createPostComment = (postId: string, body: string) => api.post<dto.PostComment>(`/posts/${id(postId)}/comments`, { body });
export const deletePostComment = (commentId: string) => api.delete<void>(`/post-comments/${id(commentId)}`);
export const like = (postId: string) => api.put(`/posts/${id(postId)}/likes`);
export const unlike = (postId: string) => api.delete<void>(`/posts/${id(postId)}/likes`);

// ── 신고 (ReportController) ──
export const report = (input: dto.ReportInput) => api.post('/reports', input);

// ── 사진 (StoredObjectController): 본문은 Base64 JSON, 올린 사람만 다시 읽을 수 있다 ──
export const uploadObject = (data_base64: string) =>
  api.post<{ id: string }>('/storage/objects', { data_base64 }, { timeoutMs: 60_000 });
export const downloadObject = (objectId: string) =>
  api.get<{ data_base64: string; byte_size: number }>(`/storage/objects/${id(objectId)}`, { timeoutMs: 60_000 });

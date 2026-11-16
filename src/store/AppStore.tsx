import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Text, View } from 'react-native';

import { ApiError, getTokens, server, setTokens, setUnauthorizedHandler } from '../api';
import type { dto } from '../api';
import { Button } from '../components/ui';
import { colors } from '../theme';
import {
  AppState,
  Comment,
  Counter,
  KnitLog,
  Membership,
  MemberStatus,
  Post,
  ProfileVisibility,
  Project,
  ProjectInvite,
  RawState,
  Reaction,
  ReportReason,
  TimerState,
  User,
} from '../types';
import { showAlert } from '../utils/alert';

export type NewProjectInput = Pick<Project, 'title' | 'coverUri'> &
  Pick<Membership, 'yarn' | 'needle' | 'status'> & {
    /** 초대를 보낼 친구 */
    inviteIds: string[];
  };

export type LogInput = Pick<KnitLog, 'startedAt' | 'durationSec' | 'text'>;
export type PostInput = Pick<Post, 'text'>;

/** 서버가 허용하는 기록 반응 코드와 화면에 보이는 이모지 */
export const REACTIONS: { code: dto.EmojiCode; emoji: string }[] = [
  { code: 'heart', emoji: '❤️' },
  { code: 'clap', emoji: '👏' },
  { code: 'like', emoji: '👍' },
  { code: 'celebrate', emoji: '🎉' },
  { code: 'wow', emoji: '😮' },
];
const emojiOf = (code: string) => REACTIONS.find((r) => r.code === code)?.emoji ?? code;
const codeOf = (emoji: string) => REACTIONS.find((r) => r.emoji === emoji)?.code;

const USER_COLORS = ['#C4704A', '#4A7BC4', '#7A9A72', '#9A7AB8', '#4E9C9A', '#C49A3A', '#C45A7A', '#6B8FA8'];

const initialState: RawState = {
  session: null,
  loading: false,
  users: {},
  friendIds: [],
  friendRequests: [],
  invites: [],
  projects: [],
  memberships: [],
  logs: [],
  posts: [],
  feedCursor: null,
  likedPostIds: [],
  blockedIds: [],
  timers: {},
  profiles: {},
};

// ── 스토어 (React 밖에 두어 비동기 액션이 항상 최신 상태를 읽는다) ──

let raw: RawState = initialState;
const listeners = new Set<() => void>();
const get = () => raw;
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
function update(fn: (s: RawState) => RawState) {
  const next = fn(raw);
  if (next === raw) return;
  raw = next;
  listeners.forEach((l) => l());
}

const without = <T,>(arr: T[], x: T) => arr.filter((v) => v !== x);
const nowIso = () => new Date().toISOString();
const uuid = () => Crypto.randomUUID();

/** 동시에 보내는 요청 수를 제한한다 (기록마다 반응·댓글을 따로 불러와야 해서 요청이 많다) */
function createPool(limit: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T,>(fn: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}
const pool = createPool(4);

// ── 서버 → 화면 형태 변환 ──

const colorOf = (id: string) => USER_COLORS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % USER_COLORS.length];

const toUser = (u: dto.User): User => ({
  id: u.id,
  name: u.nickname,
  handle: u.handle,
  bio: u.biography ?? '',
  color: colorOf(u.id),
  visibility: u.visibility,
});

const toProject = (p: dto.Project, prev?: Project): Project => ({
  id: p.id,
  title: p.name,
  ownerId: p.owner_user_id,
  coverObjectId: p.cover_photo_object_id ?? undefined,
  coverUri: p.cover_photo_object_id ? (covers.get(p.cover_photo_object_id) ?? prev?.coverUri) : undefined,
});

const toMembership = (w: dto.Workspace, prev?: Membership): Membership => ({
  projectId: w.project_id,
  userId: w.owner_user_id,
  workspaceId: w.id,
  version: w.version,
  status: w.status,
  endedAt: w.ended_at ?? undefined,
  yarn: w.yarn_notes ?? '',
  needle: w.needle_notes ?? '',
  counters: prev?.workspaceId === w.id ? prev.counters : [],
});

const toCounter = (c: dto.Counter, prev?: Counter): Counter => ({
  id: c.id,
  label: c.name,
  value: c.value,
  max: c.target_value ?? 0,
  visible: c.is_visible,
  updatedAt: prev?.updatedAt,
});

const toTimer = (t: dto.Timer | null, prev?: TimerState): TimerState | undefined => {
  if (!t || t.status === 'stopped') return undefined;
  const startedAt = t.started_at ? Math.min(Date.now(), new Date(t.started_at).getTime()) : null;
  return {
    runningSince: t.status === 'running' ? (startedAt ?? Date.now()) : null,
    accumulatedMs: t.accumulated_seconds * 1000,
    firstStartedAt: prev?.firstStartedAt ?? null,
  };
};

const toLog = (r: dto.KnitRecord, s: RawState): KnitLog => {
  const prev = s.logs.find((l) => l.id === r.id);
  return {
    id: r.id,
    projectId: s.memberships.find((m) => m.workspaceId === r.workspace_id)?.projectId ?? '',
    workspaceId: r.workspace_id,
    authorId: r.author_id,
    startedAt: r.recorded_at,
    durationSec: r.duration_seconds,
    text: r.body ?? '',
    reactions: prev?.reactions ?? [],
    comments: prev?.comments ?? [],
    socialLoaded: prev?.socialLoaded,
  };
};

const toPost = (p: dto.Post, s: RawState): Post => {
  const prev = s.posts.find((x) => x.id === p.id);
  return {
    id: p.id,
    authorId: p.author_id,
    text: p.body,
    comments: prev?.comments ?? [],
    commentsLoaded: prev?.commentsLoaded,
    createdAt: p.created_at,
  };
};

const toComment = (c: { id: string; author_id: string; body: string }): Comment => ({
  id: c.id,
  authorId: c.author_id,
  text: c.body,
});

const toReactions = (rows: dto.RecordReaction[]): Reaction[] => {
  const byEmoji = new Map<string, string[]>();
  for (const r of rows) byEmoji.set(emojiOf(r.emoji_code), [...(byEmoji.get(emojiOf(r.emoji_code)) ?? []), r.user_id]);
  return [...byEmoji].map(([emoji, userIds]) => ({ emoji, userIds }));
};

// ── 유저 캐시 ──

/** 이름만 아는 유저(기록·게시글 작성자). 프로필을 받아 오면 채워진다 */
const stubIds = new Set<string>();
/** 프로필을 받을 수 없는 유저(차단·탈퇴) — 다시 요청하지 않는다 */
const missingIds = new Set<string>();
const fetchingIds = new Set<string>();

function putUsers(list: dto.User[]) {
  if (list.length === 0) return;
  list.forEach((u) => stubIds.delete(u.id));
  update((s) => ({ ...s, users: { ...s.users, ...Object.fromEntries(list.map((u) => [u.id, toUser(u)])) } }));
}

/** 작성자 이름만으로 임시 유저를 만들어 두고, 뒤에서 프로필을 받아 온다 */
function putAuthors(list: { author_id: string; author_name: string }[]) {
  const unknown = list.filter((a) => !get().users[a.author_id]);
  if (unknown.length === 0) return;
  unknown.forEach((a) => stubIds.add(a.author_id));
  update((s) => ({
    ...s,
    users: {
      ...Object.fromEntries(
        unknown.map((a) => [
          a.author_id,
          { id: a.author_id, name: a.author_name, handle: '', bio: '', color: colorOf(a.author_id), visibility: 'private' as const },
        ]),
      ),
      ...s.users,
    },
  }));
  void ensureUsers(unknown.map((a) => a.author_id));
}

async function ensureUsers(ids: string[]) {
  const wanted = [...new Set(ids)].filter(
    (id) => id && (!get().users[id] || stubIds.has(id)) && !missingIds.has(id) && !fetchingIds.has(id),
  );
  wanted.forEach((id) => fetchingIds.add(id));
  const found: dto.User[] = [];
  await Promise.all(
    wanted.map((id) =>
      pool(() => server.user(id))
        .then((u) => found.push(u))
        .catch(() => missingIds.add(id))
        .finally(() => fetchingIds.delete(id)),
    ),
  );
  putUsers(found);
}

// ── 이 기기에만 기억하는 값 (서버가 목록을 주지 않는 것) ──

interface LocalExtras {
  likedPostIds: string[];
  /** 내가 보낸 프로젝트 초대 (취소할 때 초대 id가 필요하다) */
  sentInvites: ProjectInvite[];
}
const extrasKey = (userId: string) => `knittinglog/local/${userId}`;

async function loadExtras(userId: string): Promise<LocalExtras> {
  try {
    const json = await AsyncStorage.getItem(extrasKey(userId));
    if (json) return { likedPostIds: [], sentInvites: [], ...(JSON.parse(json) as Partial<LocalExtras>) };
  } catch {
    // 못 읽으면 빈 값으로 시작한다
  }
  return { likedPostIds: [], sentInvites: [] };
}

function saveExtras() {
  const s = get();
  if (!s.session) return;
  const extras: LocalExtras = { likedPostIds: s.likedPostIds, sentInvites: s.invites.filter((i) => i.to !== s.session) };
  AsyncStorage.setItem(extrasKey(s.session), JSON.stringify(extras)).catch(() => {});
}

// ── 대표 사진 ──

/** objectId → data URI. 받을 수 없는 사진(다른 사람이 올린 사진)은 null */
const covers = new Map<string, string | null>();

function dataUri(base64: string) {
  const mime = base64.startsWith('iVBOR')
    ? 'image/png'
    : base64.startsWith('R0lG')
      ? 'image/gif'
      : base64.startsWith('UklG')
        ? 'image/webp'
        : 'image/jpeg';
  return `data:${mime};base64,${base64}`;
}

function loadCovers() {
  for (const p of get().projects) {
    const objectId = p.coverObjectId;
    if (!objectId || covers.has(objectId)) continue;
    covers.set(objectId, null);
    pool(() => server.downloadObject(objectId))
      .then((res) => {
        const uri = dataUri(res.data_base64);
        covers.set(objectId, uri);
        update((s) => ({ ...s, projects: s.projects.map((x) => (x.coverObjectId === objectId ? { ...x, coverUri: uri } : x)) }));
      })
      .catch(() => {});
  }
}

/** 고른 사진(data URI)을 서버에 올리고 저장 객체 id를 돌려준다 */
async function uploadCover(uri: string): Promise<string> {
  const match = /^data:[^;,]*;base64,([\s\S]*)$/.exec(uri);
  if (!match) throw new ApiError('http', '사진을 읽을 수 없어요. 다시 선택해 주세요.');
  const { id } = await server.uploadObject(match[1].replace(/\s/g, ''));
  covers.set(id, uri);
  return id;
}

// ── 에러 처리 ──

function messageOf(e: unknown) {
  if (!(e instanceof ApiError)) return '알 수 없는 문제가 생겼어요. 잠시 후 다시 시도해 주세요.';
  if (e.status === 401) return '로그인이 만료됐어요. 다시 로그인해 주세요.';
  if (e.status === 429) return '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.';
  return e.message;
}

/** 현재 약관에 다시 동의해야 쓰기 요청이 통과한다 (서버 CONSENT_REQUIRED) */
function askConsent() {
  showAlert('약관 동의가 필요해요', '약관이 바뀌었어요. 현재 약관에 동의해야 계속 이용할 수 있어요.', [
    { text: '취소', style: 'cancel' },
    {
      text: '동의하기',
      onPress: () => {
        server
          .policyDocuments()
          .then((docs) => server.agreePolicies(docs.map((d) => d.id)))
          .then(() => showAlert('동의했어요', '다시 시도해 주세요.'))
          .catch((e) => showAlert('동의하지 못했어요', messageOf(e)));
      },
    },
  ]);
}

function notify(e: unknown) {
  if (e instanceof ApiError && e.code === 'CONSENT_REQUIRED') return askConsent();
  if (!(e instanceof ApiError)) console.warn(e);
  showAlert('요청을 처리하지 못했어요', messageOf(e));
}

/** 실패하면 알림을 띄우고 undefined를 돌려주는 액션으로 감싼다 */
const act =
  <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
  async (...args: A): Promise<R | undefined> => {
    try {
      return await fn(...args);
    } catch (e) {
      notify(e);
      return undefined;
    }
  };

// ── 작업 공간 명령: 순서대로 보내고 변경 번호(version)를 맞춘다 ──

const queues = new Map<string, Promise<unknown>>();

/** 같은 작업 공간의 변경은 앞선 요청이 끝난 뒤에 보낸다 */
function enqueue<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
  const next = (queues.get(workspaceId) ?? Promise.resolve()).then(fn, fn);
  queues.set(
    workspaceId,
    next.catch(() => {}),
  );
  return next;
}

const patchMembership = (workspaceId: string, fn: (m: Membership) => Membership) =>
  update((s) => ({ ...s, memberships: s.memberships.map((m) => (m.workspaceId === workspaceId ? fn(m) : m)) }));

/** 기록·카운터·타이머가 바뀌면 서버가 작업 공간 변경 번호를 1 올린다 */
const bump = (workspaceId: string) => patchMembership(workspaceId, (m) => ({ ...m, version: m.version + 1 }));

const setWorkspace = (w: dto.Workspace) => patchMembership(w.id, (m) => toMembership(w, m));

const myMembership = (projectId: string) => {
  const s = get();
  return s.memberships.find((m) => m.projectId === projectId && m.userId === s.session);
};

function requireMine(projectId: string) {
  const m = myMembership(projectId);
  if (!m) throw new ApiError('http', '프로젝트를 찾을 수 없어요.', 404);
  return m;
}

/** 변경 번호를 맞추지 않아도 되는 변경 (기록, 카운터 ±1) */
function change<T>(workspaceId: string, call: () => Promise<T>): Promise<T> {
  return enqueue(workspaceId, async () => {
    const result = await call();
    bump(workspaceId);
    return result;
  });
}

/** expected_version이 필요한 명령. 번호가 어긋났으면 서버 값으로 맞춘 뒤 한 번 더 보낸다 */
function command<T>(workspaceId: string, call: (cmd: dto.Command) => Promise<T>): Promise<T> {
  return enqueue(workspaceId, async () => {
    const version = () => get().memberships.find((m) => m.workspaceId === workspaceId)?.version ?? 0;
    let result: T;
    try {
      result = await call({ operation_id: uuid(), expected_version: version() });
    } catch (e) {
      if (!(e instanceof ApiError) || e.code !== 'VERSION_CONFLICT') throw e;
      setWorkspace(await server.workspace(workspaceId));
      result = await call({ operation_id: uuid(), expected_version: version() });
    }
    bump(workspaceId);
    return result;
  });
}

const patchCounters = (workspaceId: string, fn: (counters: Counter[]) => Counter[]) =>
  patchMembership(workspaceId, (m) => ({ ...m, counters: fn(m.counters) }));

async function reloadCounters(workspaceId: string) {
  const rows = await server.counters(workspaceId);
  patchCounters(workspaceId, (prev) => rows.map((c) => toCounter(c, prev.find((p) => p.id === c.id))));
}

function setTimer(projectId: string, timer: TimerState | undefined) {
  update((s) => {
    const timers = { ...s.timers };
    if (timer) timers[projectId] = timer;
    else delete timers[projectId];
    return { ...s, timers };
  });
}

// ── 목록 갱신 도우미 ──

/** match에 해당하는 기록을 서버에서 받은 목록으로 바꾼다 (반응·댓글은 유지) */
function replaceLogs(match: (l: KnitLog) => boolean, records: dto.KnitRecord[]) {
  putAuthors(records);
  update((s) => {
    const fresh = records.map((r) => toLog(r, s));
    const ids = new Set(fresh.map((l) => l.id));
    return { ...s, logs: [...s.logs.filter((l) => !match(l) && !ids.has(l.id)), ...fresh] };
  });
}

const patchLog = (id: string, fn: (l: KnitLog) => KnitLog) =>
  update((s) => ({ ...s, logs: s.logs.map((l) => (l.id === id ? fn(l) : l)) }));

const patchPost = (id: string, fn: (p: Post) => Post) =>
  update((s) => ({ ...s, posts: s.posts.map((p) => (p.id === id ? fn(p) : p)) }));

function requireLog(logId: string) {
  const log = get().logs.find((l) => l.id === logId);
  if (!log) throw new ApiError('http', '기록을 찾을 수 없어요.', 404);
  return log;
}

/** 차단하면 서버가 친구 관계·요청·초대를 끊는다. 화면에도 바로 반영한다 */
function applyBlock(userId: string) {
  update((s) => ({
    ...s,
    blockedIds: s.blockedIds.includes(userId) ? s.blockedIds : [...s.blockedIds, userId],
    friendIds: without(s.friendIds, userId),
    friendRequests: s.friendRequests.filter((r) => r.from !== userId && r.to !== userId),
    invites: s.invites.filter((i) => i.to !== userId),
    posts: s.posts.filter((p) => p.authorId !== userId),
  }));
  saveExtras();
}

function removeProject(projectId: string) {
  update((s) => {
    const timers = { ...s.timers };
    delete timers[projectId];
    return {
      ...s,
      projects: s.projects.filter((p) => p.id !== projectId),
      memberships: s.memberships.filter((m) => m.projectId !== projectId),
      logs: s.logs.filter((l) => l.projectId !== projectId),
      invites: s.invites.filter((i) => i.projectId !== projectId),
      timers,
    };
  });
  saveExtras();
}

// ── 불러오기 ──

let lastRefresh = 0;
const loadingSocial = new Set<string>();
const loadingComments = new Set<string>();

/** 프로젝트 하나의 멤버·작업 공간을 받아 온다 */
async function fetchMembers(projectId: string) {
  const [memberships, workspaces] = await Promise.all([
    pool(() => server.projectMemberships(projectId)),
    pool(() => server.projectWorkspaces(projectId)),
  ]);
  const memberIds = new Set(memberships.map((m) => m.user_id));
  return workspaces.filter((w) => memberIds.has(w.owner_user_id));
}

/** 메인 화면에 필요한 것 전부: 프로젝트, 친구, 요청, 초대, 차단, 내 기록, 피드 */
async function refresh() {
  const me = get().session;
  if (!me) return;
  lastRefresh = Date.now();
  const [friends, received, sent, blocked, invitations, projects, records, feed] = await Promise.all([
    server.friends(),
    server.friendRequests('received'),
    server.friendRequests('sent'),
    server.blocks(),
    server.invitations(),
    server.projects(),
    server.myRecords(),
    server.feed(),
  ]);
  const workspaces = (await Promise.all(projects.map((p) => fetchMembers(p.id)))).flat();
  if (get().session !== me) return;

  putUsers([...friends, ...blocked]);
  putAuthors(feed.items);
  update((s) => {
    const memberships = workspaces.map((w) => toMembership(w, s.memberships.find((m) => m.workspaceId === w.id)));
    const projectIds = new Set(projects.map((p) => p.id));
    const sentInvites = s.invites.filter(
      (i) => i.to !== me && projectIds.has(i.projectId) && !memberships.some((m) => m.projectId === i.projectId && m.userId === i.to),
    );
    const next: RawState = {
      ...s,
      loading: false,
      friendIds: friends.map((u) => u.id),
      blockedIds: blocked.map((u) => u.id),
      friendRequests: [...received, ...sent].map((r) => ({ id: r.id, from: r.sender_id, to: r.recipient_id })),
      invites: [...invitations.map((i) => ({ id: i.id, projectId: i.project_id, to: i.recipient_id })), ...sentInvites],
      projects: projects.map((p) => toProject(p, s.projects.find((x) => x.id === p.id))),
      memberships,
      timers: Object.fromEntries(Object.entries(s.timers).filter(([projectId]) => projectIds.has(projectId))),
      feedCursor: feed.next_cursor,
    };
    // 작업 공간이 다른 프로젝트로 옮겨졌을 수 있으니(나가기·추방) 기록의 프로젝트를 다시 맞춘다
    const mine = records.map((r) => toLog(r, next));
    const mineIds = new Set(mine.map((l) => l.id));
    const others = s.logs
      .filter((l) => l.authorId !== me && !mineIds.has(l.id))
      .map((l) => ({ ...l, projectId: memberships.find((m) => m.workspaceId === l.workspaceId)?.projectId ?? '' }));
    return { ...next, logs: [...mine, ...others], posts: feed.items.map((p) => toPost(p, s)) };
  });
  saveExtras();
  loadCovers();
  void ensureUsers([
    ...workspaces.map((w) => w.owner_user_id),
    ...projects.map((p) => p.owner_user_id),
    ...received.map((r) => r.sender_id),
    ...sent.map((r) => r.recipient_id),
    ...get().invites.map((i) => i.to),
  ]);
}

/** 프로젝트 상세: 멤버 전원의 기록 + 내 카운터·타이머 */
async function loadProject(projectId: string) {
  const me = get().session;
  if (!me) return;
  let project: dto.Project;
  let workspaces: dto.Workspace[];
  try {
    [project, workspaces] = await Promise.all([server.project(projectId), fetchMembers(projectId)]);
  } catch (e) {
    // 삭제됐거나 내보내진 프로젝트
    if (e instanceof ApiError && e.status === 404) removeProject(projectId);
    throw e;
  }
  const mine = workspaces.find((w) => w.owner_user_id === me);
  const [records, counters, timer] = await Promise.all([
    Promise.all(workspaces.map((w) => pool(() => server.workspaceRecords(w.id)))),
    mine ? server.counters(mine.id) : Promise.resolve([]),
    mine ? server.timer(mine.id) : Promise.resolve(null),
  ]);
  if (get().session !== me) return;

  update((s) => {
    const prev = s.projects.find((p) => p.id === projectId);
    const memberships = workspaces.map((w) => {
      const m = toMembership(w, s.memberships.find((x) => x.workspaceId === w.id));
      return w.id === mine?.id ? { ...m, counters: counters.map((c) => toCounter(c, m.counters.find((p) => p.id === c.id))) } : m;
    });
    return {
      ...s,
      projects: prev ? s.projects.map((p) => (p.id === projectId ? toProject(project, p) : p)) : [toProject(project), ...s.projects],
      memberships: [...s.memberships.filter((m) => m.projectId !== projectId), ...memberships],
    };
  });
  setTimer(projectId, toTimer(timer, get().timers[projectId]));
  const workspaceIds = new Set(workspaces.map((w) => w.id));
  replaceLogs((l) => workspaceIds.has(l.workspaceId), records.flat());
  loadCovers();
  void ensureUsers([project.owner_user_id, ...workspaces.map((w) => w.owner_user_id)]);
}

/** 프로필 화면: 유저 정보, 공개된 기록, 총 뜨개 시간, 게시글 */
async function loadUser(userId: string) {
  const me = get().session;
  if (!me) return;
  if (userId !== me && !get().blockedIds.includes(userId)) {
    try {
      putUsers([await server.user(userId)]);
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 404) throw e;
      // 탈퇴했거나 나를 차단한 유저
      update((s) => {
        const users = { ...s.users };
        delete users[userId];
        return { ...s, users };
      });
      return;
    }
  }
  if (get().blockedIds.includes(userId)) return;

  const [records, stats, posts] = await Promise.all([
    // 공개 범위에 막히면 403 PROFILE_PRIVATE
    server.userRecords(userId).catch((e) => {
      if (e instanceof ApiError && e.status === 403) return null;
      throw e;
    }),
    server.userStatistics(userId).catch(() => null),
    server.userPosts(userId),
  ]);
  if (records) replaceLogs((l) => l.authorId === userId, records);
  putAuthors(posts);
  update((s) => {
    const ids = new Set(posts.map((p) => p.id));
    return {
      ...s,
      profiles: { ...s.profiles, [userId]: { canViewLogs: !!records, totalSec: stats?.total_duration_seconds ?? 0 } },
      posts: [...s.posts.filter((p) => p.authorId !== userId && !ids.has(p.id)), ...posts.map((p) => toPost(p, s))],
    };
  });
}

/** 로그인 직후: 이 기기에 기억해 둔 값과 서버 데이터를 불러온다 */
async function enter(user: dto.User) {
  const extras = await loadExtras(user.id);
  update(() => ({
    ...initialState,
    session: user.id,
    loading: true,
    users: { [user.id]: toUser(user) },
    likedPostIds: extras.likedPostIds,
    invites: extras.sentInvites,
  }));
  try {
    await refresh();
  } catch (e) {
    notify(e);
  } finally {
    update((s) => ({ ...s, loading: false }));
  }
}

function leave() {
  stubIds.clear();
  missingIds.clear();
  covers.clear();
  queues.clear();
  update(() => initialState);
}

/** 가입 직후 복구 코드를 보여 주는 동안 잠시 들고 있는 유저 */
let pendingUser: dto.User | null = null;

// ── 액션 ──

const actions = {
  /** 메인 화면 데이터를 다시 불러온다 */
  refresh: act(refresh),
  /** 마지막으로 불러온 지 조금 지났을 때만 다시 불러온다 (화면에 돌아올 때) */
  refreshIfStale: () => {
    if (Date.now() - lastRefresh > 15_000) refresh().catch(() => {});
  },
  loadProject: (projectId: string) => loadProject(projectId).catch(() => {}),
  loadUser: (userId: string) => loadUser(userId).catch(() => {}),

  /** 가입. 성공하면 복구 코드를 돌려준다. 코드를 확인한 뒤 completeSignup을 불러야 메인으로 넘어간다 */
  signup: async (
    username: string,
    handle: string,
    password: string,
    name: string,
  ): Promise<{ error: string } | { recoveryCode: string }> => {
    try {
      const docs = await server.policyDocuments();
      if (docs.length === 0) return { error: '서버에 약관 문서가 아직 등록되지 않아 가입할 수 없어요.' };
      const session = await server.register({
        login_id: username,
        handle,
        nickname: name,
        password,
        policy_document_ids: docs.map((d) => d.id),
      });
      await setTokens({ access: session.access_token, refresh: session.refresh_token });
      pendingUser = session.user;
      return { recoveryCode: session.recovery_code };
    } catch (e) {
      const code = e instanceof ApiError ? e.code : '';
      if (code === 'IDENTIFIER_RESERVED') return { error: '이미 사용 중인 로그인 아이디 또는 계정 ID예요.' };
      if (code === 'INVALID_PASSWORD') return { error: '사용할 수 없는 비밀번호예요. 15자 이상으로, 흔한 비밀번호는 피해 주세요.' };
      if (code === 'INVALID_IDENTIFIER') return { error: '아이디 형식이 올바르지 않아요.' };
      return { error: messageOf(e) };
    }
  },
  completeSignup: async () => {
    const user = pendingUser;
    pendingUser = null;
    if (user) await enter(user);
  },
  /** 성공하면 null, 실패하면 에러 메시지 */
  login: async (username: string, password: string): Promise<string | null> => {
    try {
      const session = await server.login(username, password);
      await setTokens({ access: session.access_token, refresh: session.refresh_token });
      void enter(session.user);
      return null;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return '아이디 또는 비밀번호가 맞지 않아요.';
      return messageOf(e);
    }
  },
  logout: async () => {
    const tokens = await getTokens();
    // 서버 세션을 끊지 못해도 기기에서는 로그아웃한다
    if (tokens) await server.logout(tokens.refresh).catch(() => {});
    await setTokens(null);
    leave();
  },

  // ── 프로젝트 ──
  /** 새 프로젝트를 만들고 id를 돌려준다 */
  createProject: act(async (input: NewProjectInput) => {
    const me = get().session ?? '';
    const cover = input.coverUri ? await uploadCover(input.coverUri) : null;
    const project = await server.createProject({ name: input.title, cover_photo_object_id: cover });
    let workspace = (await server.projectWorkspaces(project.id)).find((w) => w.owner_user_id === me);
    if (workspace && (input.yarn || input.needle || input.status !== 'active')) {
      workspace = await server.updateWorkspace(workspace.id, {
        status: input.status,
        yarn_notes: input.yarn || null,
        needle_notes: input.needle || null,
      });
    }
    const membership = workspace ? [toMembership(workspace)] : [];
    update((s) => ({ ...s, projects: [toProject(project), ...s.projects], memberships: [...s.memberships, ...membership] }));
    // 초대는 하나씩 보내야 나중에 취소할 수 있는 초대 id를 받는다
    for (const userId of input.inviteIds) await actions.invite(project.id, userId);
    return project.id;
  }),
  updateProject: act(async (projectId: string, patch: Partial<Pick<Project, 'title' | 'coverUri'>>) => {
    const current = get().projects.find((p) => p.id === projectId);
    const input: { name?: string; cover_photo_object_id?: string | null } = {};
    if (patch.title !== undefined && patch.title !== current?.title) input.name = patch.title;
    if ('coverUri' in patch && patch.coverUri !== current?.coverUri)
      input.cover_photo_object_id = patch.coverUri ? await uploadCover(patch.coverUri) : null;
    if (Object.keys(input).length === 0) return;
    const project = await server.updateProject(projectId, input);
    update((s) => ({ ...s, projects: s.projects.map((p) => (p.id === projectId ? toProject(project, p) : p)) }));
  }),
  updateMembership: act(async (projectId: string, patch: Partial<Pick<Membership, 'yarn' | 'needle'>>) => {
    const m = requireMine(projectId);
    const input: { yarn_notes?: string | null; needle_notes?: string | null } = {};
    if (patch.yarn !== undefined && patch.yarn !== m.yarn) input.yarn_notes = patch.yarn || null;
    if (patch.needle !== undefined && patch.needle !== m.needle) input.needle_notes = patch.needle || null;
    if (Object.keys(input).length === 0) return;
    setWorkspace(await enqueue(m.workspaceId, () => server.updateWorkspace(m.workspaceId, input)));
  }),
  setMyStatus: act(async (projectId: string, status: MemberStatus) => {
    const m = requireMine(projectId);
    if (m.status === status) return;
    setWorkspace(await enqueue(m.workspaceId, () => server.updateWorkspace(m.workspaceId, { status })));
  }),

  // ── 카운터 ──
  setCounter: act(async (projectId: string, counterId: string, patch: Partial<Omit<Counter, 'id' | 'updatedAt'>>) => {
    const m = requireMine(projectId);
    const before = m.counters.find((c) => c.id === counterId);
    if (!before) return;
    const after: Counter = { ...before, ...patch, value: Math.max(0, patch.value ?? before.value) };
    if (after.value !== before.value) after.updatedAt = nowIso();
    // 누르는 즉시 화면에 반영하고, 서버에는 순서대로 보낸다
    patchCounters(m.workspaceId, (list) => list.map((c) => (c.id === counterId ? after : c)));
    const delta = after.value - before.value;
    const onlyValue = after.label === before.label && after.max === before.max && after.visible === before.visible;
    try {
      if (onlyValue && (delta === 1 || delta === -1)) {
        await change(m.workspaceId, () => server.adjustCounter(counterId, { operation_id: uuid(), delta }));
      } else if (!onlyValue || delta !== 0) {
        await command(m.workspaceId, (cmd) =>
          server.updateCounter(counterId, {
            ...cmd,
            name: after.label,
            value: after.value,
            target_value: after.max > 0 ? after.max : null,
            is_visible: after.visible,
          }),
        );
      }
    } catch (e) {
      await reloadCounters(m.workspaceId).catch(() => {});
      throw e;
    }
  }),
  /** 새 카운터를 만들고 id를 돌려준다 */
  addCounter: act(async (projectId: string) => {
    const m = requireMine(projectId);
    const counter = await command(m.workspaceId, (cmd) =>
      server.createCounter(m.workspaceId, { ...cmd, name: `단수 카운터 ${m.counters.length + 1}`, target_value: 30, is_visible: true }),
    );
    patchCounters(m.workspaceId, (list) => [...list, toCounter(counter)]);
    return counter.id;
  }),
  deleteCounter: act(async (projectId: string, counterId: string) => {
    const m = requireMine(projectId);
    await command(m.workspaceId, (cmd) => server.deleteCounter(counterId, cmd));
    patchCounters(m.workspaceId, (list) => list.filter((c) => c.id !== counterId));
  }),
  moveCounter: act(async (projectId: string, counterId: string, dir: -1 | 1) => {
    const m = requireMine(projectId);
    const i = m.counters.findIndex((c) => c.id === counterId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= m.counters.length) return;
    const counters = [...m.counters];
    [counters[i], counters[j]] = [counters[j], counters[i]];
    patchCounters(m.workspaceId, () => counters);
    try {
      // 큐에서 차례가 왔을 때의 순서를 보낸다 (연달아 옮겨도 마지막 순서가 반영된다)
      await command(m.workspaceId, (cmd) =>
        server.orderCounters(m.workspaceId, { ...cmd, counter_ids: (myMembership(projectId)?.counters ?? counters).map((c) => c.id) }),
      );
    } catch (e) {
      await reloadCounters(m.workspaceId).catch(() => {});
      throw e;
    }
  }),

  // ── 방장·멤버·초대 ──
  /** 성공하면 true */
  deleteProject: act(async (projectId: string) => {
    await server.deleteProject(projectId);
    removeProject(projectId);
    return true;
  }),
  transferOwner: act(async (projectId: string, userId: string) => {
    const project = await server.transferOwner(projectId, userId);
    update((s) => ({ ...s, projects: s.projects.map((p) => (p.id === projectId ? toProject(project, p) : p)) }));
    return true;
  }),
  /** 나가기. 내 기록이 옮겨진 새 개인 프로젝트 id를 돌려준다 */
  leaveProject: act(async (projectId: string) => {
    const m = requireMine(projectId);
    const transfer = await command(m.workspaceId, (cmd) => server.leaveProject(projectId, { ...cmd, workspace_id: m.workspaceId }));
    await refresh();
    return transfer.to_project_id;
  }),
  kickMember: act(async (projectId: string, userId: string) => {
    const target = () => get().memberships.find((m) => m.projectId === projectId && m.userId === userId);
    const kick = (m: Membership) =>
      server.kickMember(projectId, userId, { operation_id: uuid(), workspace_id: m.workspaceId, expected_version: m.version });
    const m = target();
    if (!m) return;
    try {
      await kick(m);
    } catch (e) {
      if (!(e instanceof ApiError) || e.code !== 'VERSION_CONFLICT') throw e;
      // 그 사이 상대가 기록을 남겼으면 변경 번호가 달라진다
      await loadProject(projectId);
      const latest = target();
      if (!latest) return;
      await kick(latest);
    }
    await loadProject(projectId);
  }),
  invite: act(async (projectId: string, userId: string) => {
    const invitation = await server.invite(projectId, userId);
    update((s) => ({ ...s, invites: [...s.invites, { id: invitation.id, projectId, to: userId }] }));
    saveExtras();
  }),
  cancelInvite: act(async (projectId: string, userId: string) => {
    const invite = get().invites.find((i) => i.projectId === projectId && i.to === userId);
    if (!invite) return;
    try {
      await server.cancelInvitation(invite.id);
    } catch (e) {
      // 이미 수락·거절된 초대면 목록에서만 지운다
      if (!(e instanceof ApiError) || (e.status !== 404 && e.status !== 409)) throw e;
    }
    update((s) => ({ ...s, invites: s.invites.filter((i) => i.id !== invite.id) }));
    saveExtras();
  }),
  /** 초대를 수락하고 참여한 프로젝트 id를 돌려준다 */
  acceptInvite: act(async (inviteId: string) => {
    const membership = await server.acceptInvitation(inviteId);
    update((s) => ({ ...s, invites: s.invites.filter((i) => i.id !== inviteId) }));
    await refresh();
    return membership.project_id;
  }),
  declineInvite: act(async (inviteId: string) => {
    await server.rejectInvitation(inviteId);
    update((s) => ({ ...s, invites: s.invites.filter((i) => i.id !== inviteId) }));
  }),

  // ── 기록 ──
  addLog: act(async (projectId: string, input: LogInput) => {
    const m = requireMine(projectId);
    const record = await change(m.workspaceId, () =>
      server.createRecord(m.workspaceId, {
        operation_id: uuid(),
        source: 'manual',
        body: input.text || null,
        duration_seconds: input.durationSec,
        recorded_at: input.startedAt,
      }),
    );
    update((s) => ({ ...s, logs: [...s.logs, { ...toLog(record, s), socialLoaded: true }] }));
    return true;
  }),
  /** 서버는 내용과 뜬 시간만 고칠 수 있다 (기록 시각은 그대로) */
  updateLog: act(async (logId: string, input: LogInput) => {
    const log = requireLog(logId);
    const record = await change(log.workspaceId, () =>
      server.updateRecord(logId, { body: input.text || null, duration_seconds: input.durationSec }),
    );
    patchLog(logId, (l) => ({ ...l, text: record.body ?? '', durationSec: record.duration_seconds }));
    return true;
  }),
  deleteLog: act(async (logId: string) => {
    const log = requireLog(logId);
    await change(log.workspaceId, () => server.deleteRecord(logId));
    update((s) => ({ ...s, logs: s.logs.filter((l) => l.id !== logId) }));
  }),
  /** 기록의 반응·댓글을 한 번만 불러온다 */
  loadLogSocial: (logId: string) => {
    const log = get().logs.find((l) => l.id === logId);
    if (!log || !log.projectId || log.socialLoaded || loadingSocial.has(logId)) return;
    loadingSocial.add(logId);
    pool(() => Promise.all([server.recordReactions(logId), server.recordComments(logId)]))
      .then(([reactions, comments]) => {
        putAuthors(comments);
        void ensureUsers(reactions.map((r) => r.user_id));
        patchLog(logId, (l) => ({ ...l, reactions: toReactions(reactions), comments: comments.map(toComment), socialLoaded: true }));
        loadingSocial.delete(logId);
      })
      // 실패하면 이번 실행 동안은 다시 시도하지 않는다
      .catch(() => {});
  },
  toggleReaction: act(async (logId: string, emoji: string) => {
    const me = get().session ?? '';
    const code = codeOf(emoji);
    if (!code) return;
    const on = requireLog(logId).reactions.some((r) => r.emoji === emoji && r.userIds.includes(me));
    if (on) await server.unreact(logId, code);
    else await server.react(logId, code);
    patchLog(logId, (l) => {
      const rest = l.reactions.map((r) => (r.emoji === emoji ? { ...r, userIds: without(r.userIds, me) } : r));
      const reactions = on
        ? rest
        : rest.some((r) => r.emoji === emoji)
          ? rest.map((r) => (r.emoji === emoji ? { ...r, userIds: [...r.userIds, me] } : r))
          : [...rest, { emoji, userIds: [me] }];
      return { ...l, reactions: reactions.filter((r) => r.userIds.length > 0) };
    });
  }),
  addComment: act(async (logId: string, text: string) => {
    const comment = await server.createRecordComment(logId, text);
    patchLog(logId, (l) => ({ ...l, comments: [...l.comments, { ...toComment(comment), createdAt: nowIso() }] }));
  }),
  deleteComment: act(async (logId: string, commentId: string) => {
    await server.deleteRecordComment(commentId);
    patchLog(logId, (l) => ({ ...l, comments: l.comments.filter((c) => c.id !== commentId) }));
  }),

  // ── 타이머 (서버가 시간을 잰다) ──
  timerStart: act(async (projectId: string) => {
    const m = requireMine(projectId);
    const current = get().timers[projectId];
    if (current?.runningSince) return;
    try {
      const timer = await command(m.workspaceId, (cmd) => server.timerCommand(m.workspaceId, current ? 'resume' : 'start', cmd));
      setTimer(projectId, {
        runningSince: Date.now(),
        accumulatedMs: timer.accumulated_seconds * 1000,
        firstStartedAt: current?.firstStartedAt ?? Date.now(),
      });
    } catch (e) {
      // 다른 기기에서 타이머를 조작했으면 서버 상태로 맞춘다
      setTimer(projectId, toTimer(await server.timer(m.workspaceId).catch(() => null), current));
      throw e;
    }
  }),
  timerPause: act(async (projectId: string) => {
    const m = requireMine(projectId);
    const current = get().timers[projectId];
    if (!current?.runningSince) return;
    // 화면의 시계는 바로 멈추고, 서버가 계산한 시간으로 맞춘다
    setTimer(projectId, { ...current, runningSince: null, accumulatedMs: current.accumulatedMs + (Date.now() - current.runningSince) });
    try {
      const timer = await command(m.workspaceId, (cmd) => server.timerCommand(m.workspaceId, 'pause', cmd));
      setTimer(projectId, { runningSince: null, accumulatedMs: timer.accumulated_seconds * 1000, firstStartedAt: current.firstStartedAt });
    } catch (e) {
      setTimer(projectId, toTimer(await server.timer(m.workspaceId).catch(() => null), current));
      throw e;
    }
  }),
  /** 타이머를 끝내고 그 시간으로 기록을 남긴다. 성공하면 true */
  finishTimer: act(async (projectId: string, text: string) => {
    const m = requireMine(projectId);
    const record = await command(m.workspaceId, (cmd) => server.stopTimer(m.workspaceId, { ...cmd, body: text || null }));
    setTimer(projectId, undefined);
    update((s) => ({ ...s, logs: [...s.logs, { ...toLog(record, s), socialLoaded: true }] }));
    return true;
  }),
  /** 기록을 남기지 않고 타이머를 끝낸다 (서버는 종료할 때 항상 기록을 만들므로 바로 지운다) */
  discardTimer: act(async (projectId: string) => {
    const m = requireMine(projectId);
    const record = await command(m.workspaceId, (cmd) => server.stopTimer(m.workspaceId, cmd));
    setTimer(projectId, undefined);
    await change(m.workspaceId, () => server.deleteRecord(record.id));
  }),

  // ── 게시글 ──
  /** 성공하면 true */
  createPost: act(async (input: PostInput) => {
    const post = await server.createPost(input.text);
    update((s) => ({ ...s, posts: [{ ...toPost(post, s), commentsLoaded: true }, ...s.posts] }));
    return true;
  }),
  deletePost: act(async (postId: string) => {
    await server.deletePost(postId);
    update((s) => ({ ...s, posts: s.posts.filter((p) => p.id !== postId) }));
  }),
  loadMoreFeed: act(async () => {
    const cursor = get().feedCursor;
    if (!cursor) return;
    const feed = await server.feed(cursor);
    putAuthors(feed.items);
    update((s) => {
      const known = new Set(s.posts.map((p) => p.id));
      return { ...s, feedCursor: feed.next_cursor, posts: [...s.posts, ...feed.items.filter((p) => !known.has(p.id)).map((p) => toPost(p, s))] };
    });
  }),
  toggleLike: act(async (postId: string) => {
    const liked = get().likedPostIds.includes(postId);
    if (liked) await server.unlike(postId);
    else await server.like(postId);
    update((s) => ({ ...s, likedPostIds: liked ? without(s.likedPostIds, postId) : [...s.likedPostIds, postId] }));
    saveExtras();
  }),
  /** 게시글 댓글을 한 번만 불러온다 */
  loadPostComments: (postId: string) => {
    const post = get().posts.find((p) => p.id === postId);
    if (!post || post.commentsLoaded || loadingComments.has(postId)) return;
    loadingComments.add(postId);
    pool(() => server.postComments(postId))
      .then((comments) => {
        putAuthors(comments);
        patchPost(postId, (p) => ({ ...p, comments: comments.map(toComment), commentsLoaded: true }));
        loadingComments.delete(postId);
      })
      .catch(() => {});
  },
  addPostComment: act(async (postId: string, text: string) => {
    const comment = await server.createPostComment(postId, text);
    patchPost(postId, (p) => ({ ...p, comments: [...p.comments, { ...toComment(comment), createdAt: nowIso() }] }));
  }),
  deletePostComment: act(async (postId: string, commentId: string) => {
    await server.deletePostComment(commentId);
    patchPost(postId, (p) => ({ ...p, comments: p.comments.filter((c) => c.id !== commentId) }));
  }),

  // ── 프로필 ──
  updateBio: act(async (bio: string) => putUsers([await server.updateMe({ biography: bio || null })])),
  setVisibility: act(async (visibility: ProfileVisibility) => putUsers([await server.updateMe({ visibility })])),
  /** 계정 ID 변경. 성공하면 null, 실패하면 에러 메시지 */
  updateHandle: async (handle: string): Promise<string | null> => {
    try {
      putUsers([await server.updateMe({ handle })]);
      return null;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'IDENTIFIER_RESERVED') return '이미 사용 중인 계정 ID예요.';
      if (e instanceof ApiError && e.code === 'CONSENT_REQUIRED') askConsent();
      return messageOf(e);
    }
  },
  /** 계정 ID·닉네임으로 유저를 찾는다 (나와 차단 관계인 유저는 빠진다) */
  searchUsers: async (query: string): Promise<User[]> => {
    const found = await server.searchUsers(query);
    putUsers(found);
    return found.filter((u) => u.id !== get().session).map(toUser);
  },

  // ── 신고 · 차단 ──
  /** 게시글 id가 있으면 게시글 신고, 없으면 유저 신고. 성공하면 true */
  report: act(async (targetUserId: string, reason: ReportReason, detail: string, targetPostId?: string, alsoBlock?: boolean) => {
    await server.report({
      reason_code: reason,
      detail: detail || null,
      ...(targetPostId ? { post_id: targetPostId } : { target_user_id: targetUserId }),
      block_target: !!alsoBlock,
    });
    if (alsoBlock) applyBlock(targetUserId);
    return true;
  }),
  block: act(async (userId: string) => {
    await server.block(userId);
    applyBlock(userId);
  }),
  unblock: act(async (userId: string) => {
    await server.unblock(userId);
    update((s) => ({ ...s, blockedIds: without(s.blockedIds, userId) }));
    refresh().catch(() => {});
  }),

  // ── 친구 ──
  sendFriendRequest: act(async (userId: string) => {
    const me = get().session ?? '';
    const request = await server.sendFriendRequest(userId);
    update((s) =>
      request.status === 'accepted'
        ? {
            ...s,
            friendIds: s.friendIds.includes(userId) ? s.friendIds : [...s.friendIds, userId],
            friendRequests: s.friendRequests.filter((r) => r.from !== userId && r.to !== userId),
          }
        : { ...s, friendRequests: [...s.friendRequests.filter((r) => r.id !== request.id), { id: request.id, from: me, to: userId }] },
    );
  }),
  cancelFriendRequest: act(async (userId: string) => {
    const request = get().friendRequests.find((r) => r.to === userId);
    if (!request) return;
    await server.cancelFriendRequest(request.id);
    update((s) => ({ ...s, friendRequests: s.friendRequests.filter((r) => r.id !== request.id) }));
  }),
  acceptFriend: act(async (userId: string) => {
    const request = get().friendRequests.find((r) => r.from === userId);
    if (!request) return;
    await server.acceptFriendRequest(request.id);
    update((s) => ({
      ...s,
      friendIds: s.friendIds.includes(userId) ? s.friendIds : [...s.friendIds, userId],
      friendRequests: s.friendRequests.filter((r) => r.from !== userId && r.to !== userId),
    }));
  }),
  rejectFriend: act(async (userId: string) => {
    const request = get().friendRequests.find((r) => r.from === userId);
    if (!request) return;
    await server.rejectFriendRequest(request.id);
    update((s) => ({ ...s, friendRequests: s.friendRequests.filter((r) => r.id !== request.id) }));
  }),
  removeFriend: act(async (userId: string) => {
    await server.unfriend(userId);
    update((s) => ({ ...s, friendIds: without(s.friendIds, userId) }));
  }),
};

type Actions = typeof actions;

// ── 화면에서 쓰는 형태 ──

/** 로그인한 유저 기준으로 화면에서 쓰기 편한 값을 계산한다 */
function selectView(s: RawState): AppState {
  const me = s.session ?? '';
  // 서버는 참여 시작일을 주지 않아 첫 기록 시각을 시작일로 쓴다
  const firstLog = new Map<string, string>();
  for (const l of s.logs) {
    const key = `${l.projectId}:${l.authorId}`;
    const cur = firstLog.get(key);
    if (!cur || l.startedAt < cur) firstLog.set(key, l.startedAt);
  }
  return {
    ...s,
    meId: me,
    memberships: s.memberships.map((m) => ({ ...m, startedAt: firstLog.get(`${m.projectId}:${m.userId}`) })),
    incomingRequestIds: s.friendRequests.filter((r) => r.to === me).map((r) => r.from),
    outgoingRequestIds: s.friendRequests.filter((r) => r.from === me).map((r) => r.to),
    incomingInvites: s.invites.filter((i) => i.to === me),
    hiddenIds: s.blockedIds,
  };
}

let viewOf: RawState | undefined;
let view: AppState;
function getView() {
  if (viewOf !== raw) {
    view = selectView(raw);
    viewOf = raw;
  }
  return view;
}

export function useStore(): { state: AppState; actions: Actions } {
  const state = useSyncExternalStore(subscribe, getView, getView);
  return { state, actions };
}

type Boot = 'loading' | 'ready' | 'offline';

/** 앱을 열 때 저장된 토큰으로 로그인 상태를 되살린다 */
export function AppStoreProvider({ children }: { children: React.ReactNode }) {
  const [boot, setBoot] = useState<Boot>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setUnauthorizedHandler(leave);
    let cancelled = false;
    (async () => {
      try {
        if (await getTokens()) {
          const user = await server.me();
          if (!cancelled) void enter(user);
        }
        if (!cancelled) setBoot('ready');
      } catch (e) {
        if (cancelled) return;
        // 토큰이 만료돼 갱신도 못 했으면 로그인 화면으로, 서버에 닿지 못했으면 다시 시도할 수 있게 한다
        setBoot(e instanceof ApiError && e.kind === 'http' ? 'ready' : 'offline');
      }
    })();
    return () => {
      cancelled = true;
      setUnauthorizedHandler(undefined);
    };
  }, [attempt]);

  if (boot === 'loading') return null;
  if (boot === 'offline') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16, backgroundColor: colors.bg }}>
        <Text style={{ fontSize: 40 }}>🧶</Text>
        <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>서버에 연결할 수 없어요</Text>
        <Text style={{ fontSize: 13, color: colors.textSub, textAlign: 'center' }}>네트워크 상태를 확인한 뒤 다시 시도해 주세요.</Text>
        <Button
          title="다시 시도"
          onPress={() => {
            setBoot('loading');
            setAttempt((n) => n + 1);
          }}
        />
      </View>
    );
  }
  return <>{children}</>;
}

export const membersOf = (state: Pick<RawState, 'memberships'>, projectId: string) =>
  state.memberships.filter((m) => m.projectId === projectId);

/** 프로필에서 그 사람의 기록을 볼 수 있는지: 본인이거나 서버가 기록을 내려준 경우 */
export function canViewProfileLogs(state: AppState, userId: string) {
  if (!state.users[userId] || state.hiddenIds.includes(userId)) return false;
  return userId === state.meId || !!state.profiles[userId]?.canViewLogs;
}

export const visibilityLabels = { public: '전체 공개', friends: '친구 공개', private: '비공개' } as const;

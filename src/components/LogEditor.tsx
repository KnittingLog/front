import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { LogInput } from '../store/AppStore';
import { colors, fonts } from '../theme';
import { KnitLog } from '../types';
import { clockTime, duration, fullDate, parseDateTime, toDateInput, toTimeInput } from '../utils/format';
import { Button, Sheet } from './ui';
import { showAlert } from '../utils/alert';

export type EditorMode =
  | { kind: 'timer'; startedAt: number; durationSec: number }
  | { kind: 'manual' }
  | { kind: 'edit'; log: KnitLog };

const MAX_TEXT = 150;

/**
 * 뜨개 기록 작성 팝업.
 * - timer: 타이머 종료 후. 날짜·시간·소요 시간은 자동으로 채워진다.
 * - manual: 수동 추가. 날짜·시간·소요 시간을 직접 입력한다.
 * - edit: 기존 기록 수정.
 */
export function LogEditor({
  mode,
  onClose,
  onSave,
  onSkip,
}: {
  mode: EditorMode;
  onClose: () => void;
  /** 저장이 끝날 때까지 기다린다 (서버 요청) */
  onSave: (input: LogInput) => void | Promise<void>;
  /** timer 모드에서 '기록 안 함' */
  onSkip?: () => void;
}) {
  // 열릴 때마다 새로 마운트되므로(부모에서 key 지정) 초기값을 props에서 바로 계산한다
  const [start] = useState(() =>
    mode.kind === 'edit'
      ? new Date(mode.log.startedAt)
      : mode.kind === 'timer'
        ? new Date(mode.startedAt)
        : new Date(Date.now() - 3600 * 1000),
  );
  const [text, setText] = useState(mode.kind === 'edit' ? mode.log.text : '');
  const [saving, setSaving] = useState(false);
  const [date, setDate] = useState(toDateInput(start));
  const [time, setTime] = useState(toTimeInput(start));
  const [minutes, setMinutes] = useState(mode.kind === 'edit' ? String(Math.round(mode.log.durationSec / 60)) : '60');

  const save = async () => {
    if (saving) return;
    let startedAt: string;
    let durationSec: number;
    if (mode.kind === 'timer') {
      startedAt = new Date(mode.startedAt).toISOString();
      durationSec = mode.durationSec;
    } else if (mode.kind === 'edit') {
      // 서버는 기록 시각을 바꿀 수 없다. 내용과 뜬 시간만 고친다
      const m = Number(minutes);
      if (!Number.isFinite(m) || m < 0) {
        showAlert('소요 시간 확인', '뜬 시간을 분 단위 숫자로 입력해 주세요.');
        return;
      }
      startedAt = mode.log.startedAt;
      durationSec = Math.round(m * 60);
    } else {
      const d = parseDateTime(date, time);
      if (!d) {
        showAlert('날짜/시간 확인', '날짜는 2026-09-15, 시간은 21:00 형식으로 입력해 주세요.');
        return;
      }
      const m = Number(minutes);
      if (!Number.isFinite(m) || m < 0) {
        showAlert('소요 시간 확인', '뜬 시간을 분 단위 숫자로 입력해 주세요.');
        return;
      }
      startedAt = d.toISOString();
      durationSec = Math.round(m * 60);
    }
    setSaving(true);
    try {
      await onSave({ startedAt, durationSec, text: text.trim() });
    } finally {
      setSaving(false);
    }
  };

  const title = mode.kind === 'timer' ? '오늘의 뜨개를 기록할까요?' : mode.kind === 'edit' ? '기록 수정' : '기록 추가';

  return (
    <Sheet visible onClose={onClose} title={title}>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {mode.kind === 'timer' ? (
          <View style={styles.autoInfo}>
            <Ionicons name="time-outline" size={16} color={colors.primary} />
            <Text style={styles.autoText}>
              {fullDate(new Date(mode.startedAt).toISOString())} {clockTime(new Date(mode.startedAt).toISOString())} ·{' '}
              {duration(mode.durationSec)}
            </Text>
          </View>
        ) : (
          <View style={styles.row}>
            <Field label="날짜" value={date} onChangeText={setDate} placeholder="2026-09-15" flex={1.4} editable={mode.kind !== 'edit'} />
            <Field label="시작 시각" value={time} onChangeText={setTime} placeholder="21:00" flex={1} editable={mode.kind !== 'edit'} />
            <Field label="뜬 시간(분)" value={minutes} onChangeText={setMinutes} placeholder="60" numeric flex={1} />
          </View>
        )}

        <Text style={styles.label}>오늘의 기록</Text>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="오늘 뜬 내용을 2~3줄로 남겨 보세요"
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={MAX_TEXT}
          style={styles.textarea}
          textAlignVertical="top"
        />
        <Text style={styles.counter}>
          {text.length}/{MAX_TEXT}
        </Text>

        <View style={[styles.row, { marginTop: 22 }]}>
          {mode.kind === 'timer' ? (
            <Button title="기록 안 함" variant="outline" onPress={onSkip} style={{ flex: 1 }} />
          ) : (
            <Button title="취소" variant="outline" onPress={onClose} style={{ flex: 1 }} />
          )}
          <Button title={saving ? '저장 중…' : '저장'} onPress={save} disabled={saving} style={{ flex: 1.4 }} />
        </View>
      </ScrollView>
    </Sheet>
  );
}

function Field({
  label,
  flex,
  numeric,
  editable = true,
  ...props
}: {
  label: string;
  flex: number;
  numeric?: boolean;
  editable?: boolean;
  value: string;
  onChangeText: (s: string) => void;
  placeholder?: string;
}) {
  return (
    <View style={{ flex }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...props}
        keyboardType={numeric ? 'number-pad' : 'numbers-and-punctuation'}
        editable={editable}
        placeholderTextColor={colors.textMuted}
        style={[styles.input, !editable && { color: colors.textMuted }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  autoInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primarySoft,
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  autoText: { fontFamily: fonts.mono, fontSize: 13, color: colors.primaryDark },
  label: { fontSize: 13, fontWeight: '700', color: colors.textSub, marginBottom: 6 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
    fontFamily: fonts.mono,
  },
  textarea: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 12,
    minHeight: 88,
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
  },
  counter: { alignSelf: 'flex-end', fontSize: 11, color: colors.textMuted, marginTop: 4, marginBottom: 8 },
});

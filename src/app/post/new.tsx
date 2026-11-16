import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, IconButton } from '../../components/ui';
import { useStore } from '../../store/AppStore';
import { colors } from '../../theme';

const MAX_TEXT = 300;

export default function NewPostScreen() {
  const insets = useSafeAreaInsets();
  const { actions } = useStore();
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);

  // 서버 게시글은 글만 담는다 (본문 필수)
  const canPost = !!text.trim() && !posting;
  const submit = async () => {
    if (!canPost) return;
    setPosting(true);
    const ok = await actions.createPost({ text: text.trim() });
    setPosting(false);
    if (ok) router.back();
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.header, { paddingTop: Platform.OS === 'ios' ? 16 : insets.top + 8 }]}>
        <IconButton name="close" onPress={() => router.back()} size={26} />
        <Text style={styles.headerTitle}>게시글 쓰기</Text>
        <Button small title={posting ? '게시 중…' : '게시'} onPress={submit} disabled={!canPost} />
      </View>

      <ScrollView contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled">
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="작품 이야기를 들려주세요"
          placeholderTextColor={colors.textMuted}
          multiline
          autoFocus
          maxLength={MAX_TEXT}
          style={styles.textarea}
        />
        <Text style={styles.counter}>
          {text.length}/{MAX_TEXT}
        </Text>
        <Text style={styles.help}>게시글은 피드에서 모든 사용자에게 보여요. 프로필 공개 설정과는 별개예요.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  container: { padding: 20 },
  textarea: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 14,
    minHeight: 110,
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
    textAlignVertical: 'top',
  },
  counter: { alignSelf: 'flex-end', fontSize: 11, color: colors.textMuted, marginTop: 4, marginBottom: 16 },
  help: { fontSize: 12, lineHeight: 17, color: colors.textSub },
});

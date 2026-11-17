import type { ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
export const colors = {
  bg: "#141116",
  card: "#231F28",
  soft: "#302735",
  pink: "#F2AAC5",
  wine: "#613047",
  text: "#F7EEF2",
  muted: "#B0A3AE",
  mint: "#A9DCCB",
  line: "#43343F",
};
export const s = StyleSheet.create({
  title: {
    fontSize: 31,
    fontWeight: "700",
    color: colors.text,
    letterSpacing: -1,
    lineHeight: 41,
  },
  body: { fontSize: 15, color: colors.muted, lineHeight: 23 },
  label: { fontSize: 13, color: colors.muted, letterSpacing: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 26,
    padding: 22,
    gap: 16,
  },
  chip: {
    borderRadius: 20,
    paddingVertical: 11,
    paddingHorizontal: 16,
    backgroundColor: colors.soft,
  },
  input: {
    backgroundColor: "#19161D",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    fontSize: 16,
    color: colors.text,
    minHeight: 54,
  },
  section: { fontSize: 19, fontWeight: "600", color: colors.text },
  error: { color: "#FFB3BB", fontSize: 14, lineHeight: 21 },
});
export function Screen({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.bg }}
      edges={["top", "left", "right"]}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 24, paddingBottom: 40, gap: 24 }}
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
export function Card({ children }: { children: ReactNode }) {
  return <View style={s.card}>{children}</View>;
}
export function Body({ children }: { children: ReactNode }) {
  return <Text style={s.body}>{children}</Text>;
}
export function Title({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={s.title}>
      {children}
    </Text>
  );
}
export function Button({
  title,
  onPress,
  disabled = false,
  secondary = false,
  busy = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
  busy?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: secondary ? colors.soft : colors.pink,
        padding: 17,
        borderRadius: 18,
        alignItems: "center",
        opacity: disabled || busy ? 0.45 : pressed ? 0.75 : 1,
      })}
    >
      {busy ? (
        <ActivityIndicator color={colors.bg} />
      ) : (
        <Text
          style={{
            fontSize: 16,
            fontWeight: "700",
            color: secondary ? colors.text : "#2B1822",
          }}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor="#776B79"
        style={[
          s.input,
          props.multiline ? { minHeight: 120, textAlignVertical: "top" } : null,
        ]}
        autoCapitalize="none"
        {...props}
      />
    </View>
  );
}
export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        s.chip,
        selected && {
          backgroundColor: colors.wine,
          borderColor: colors.pink,
          borderWidth: 1,
        },
      ]}
    >
      <Text
        style={{ color: selected ? colors.pink : colors.text, fontSize: 14 }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
export function Notice({ text }: { text: string }) {
  return text ? (
    <Text accessibilityLiveRegion="polite" style={s.error}>
      {text}
    </Text>
  ) : null;
}
export function Brand() {
  return (
    <View style={s.row}>
      <View
        style={{ backgroundColor: colors.wine, borderRadius: 14, padding: 12 }}
      >
        <Text style={{ color: colors.pink, fontSize: 20 }}>♡</Text>
      </View>
      <Text style={{ color: colors.pink, fontWeight: "600", letterSpacing: 2 }}>
        두데이 (2DAY)
      </Text>
    </View>
  );
}

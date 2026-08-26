import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import * as Sharing from "expo-sharing";
import { downloadDocumentFile, getDocument } from "../lib/api";

export function DocumentDetailScreen({ documentId, onBack }: { documentId: string; onBack: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["document", documentId],
    queryFn: () => getDocument(documentId),
  });
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  async function handleDownload() {
    if (!data) return;
    setDownloadError(null);
    setDownloading(true);
    try {
      const uri = await downloadDocumentFile(data.id, `${data.documentNumber}.bin`);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri);
      }
    } catch {
      setDownloadError("Could not download this document.");
    } finally {
      setDownloading(false);
    }
  }

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#93c5fd" />
      </View>
    );
  }

  if (error || !data) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>Could not load this document.</Text>
        <Pressable onPress={onBack}>
          <Text style={styles.link}>Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Pressable onPress={onBack}>
        <Text style={styles.link}>{"< Back"}</Text>
      </Pressable>

      <Text style={styles.title}>{data.title}</Text>
      <Text style={styles.documentNumber}>{data.documentNumber}</Text>

      <View style={styles.card}>
        <Row label="Type" value={data.documentType} />
        <Row label="Classification" value={data.classification} />
        <Row label="Status" value={data.status} />
        {data.issuer ? <Row label="Issuer" value={data.issuer} /> : null}
        {data.ownerName ? <Row label="Owner" value={data.ownerName} /> : null}
        <Row label="Versions" value={String(data.versionCount)} />
      </View>

      {data.currentVersion ? (
        <View style={styles.card}>
          <Text style={styles.cardHeading}>Current Version Fingerprint</Text>
          <Row label="Version" value={String(data.currentVersion.versionNumber)} />
          <Row label="Size" value={`${data.currentVersion.sizeBytes.toLocaleString()} bytes`} />
          <Row label="MIME type" value={data.currentVersion.mimeType} />
          <Text style={styles.hashLabel}>SHA-256</Text>
          <Text selectable style={styles.hashValue}>
            {data.currentVersion.sha256}
          </Text>
        </View>
      ) : null}

      {downloadError ? <Text style={styles.error}>{downloadError}</Text> : null}

      <Pressable style={styles.button} onPress={handleDownload} disabled={downloading}>
        {downloading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Download Original</Text>}
      </Pressable>
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b1220" },
  content: { padding: 20, paddingTop: 56, paddingBottom: 48 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0b1220", gap: 12 },
  link: { color: "#93c5fd", marginBottom: 16 },
  title: { color: "#fff", fontSize: 22, fontWeight: "700" },
  documentNumber: { color: "#93c5fd", fontSize: 14, marginBottom: 20 },
  card: {
    backgroundColor: "#141b2d",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#243044",
    padding: 16,
    marginBottom: 16,
  },
  cardHeading: { color: "#fff", fontWeight: "600", marginBottom: 10 },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  rowLabel: { color: "#64748b" },
  rowValue: { color: "#e2e8f0", maxWidth: "60%", textAlign: "right" },
  hashLabel: { color: "#64748b", marginTop: 8, marginBottom: 4 },
  hashValue: { color: "#e2e8f0", fontFamily: "monospace", fontSize: 12 },
  button: { backgroundColor: "#2563eb", borderRadius: 8, paddingVertical: 14, alignItems: "center" },
  buttonText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  error: { color: "#f87171", marginBottom: 12 },
});

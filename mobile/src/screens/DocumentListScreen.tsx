import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { listDocuments, logout, type DocumentSummary } from "../lib/api";

export function DocumentListScreen({
  onSelectDocument,
  onLoggedOut,
}: {
  onSelectDocument: (id: string) => void;
  onLoggedOut: () => void;
}) {
  const { data, isLoading, isRefetching, refetch, error } = useQuery({
    queryKey: ["documents"],
    queryFn: listDocuments,
  });

  async function handleLogout() {
    await logout();
    onLoggedOut();
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Registered Documents</Text>
        <Pressable onPress={handleLogout}>
          <Text style={styles.logout}>Log out</Text>
        </Pressable>
      </View>

      {error ? <Text style={styles.error}>Could not load documents.</Text> : null}

      <FlatList
        data={data ?? []}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={isLoading || isRefetching} onRefresh={refetch} />}
        contentContainerStyle={data?.length === 0 ? styles.emptyContainer : undefined}
        ListEmptyComponent={
          !isLoading ? <Text style={styles.emptyText}>No documents registered yet.</Text> : null
        }
        renderItem={({ item }) => <DocumentRow item={item} onPress={() => onSelectDocument(item.id)} />}
      />
    </View>
  );
}

function DocumentRow({ item, onPress }: { item: DocumentSummary; onPress: () => void }) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <Text style={styles.rowTitle}>{item.title}</Text>
      <Text style={styles.rowNumber}>{item.documentNumber}</Text>
      <Text style={styles.rowType}>{item.documentType.toUpperCase()}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b1220", paddingTop: 56 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  title: { fontSize: 22, fontWeight: "700", color: "#fff" },
  logout: { color: "#93c5fd" },
  error: { color: "#f87171", paddingHorizontal: 20, marginBottom: 8 },
  row: {
    backgroundColor: "#141b2d",
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#243044",
  },
  rowTitle: { color: "#fff", fontSize: 16, fontWeight: "600", marginBottom: 4 },
  rowNumber: { color: "#93c5fd", fontSize: 13, marginBottom: 2 },
  rowType: { color: "#64748b", fontSize: 12 },
  emptyContainer: { flexGrow: 1, justifyContent: "center", alignItems: "center" },
  emptyText: { color: "#64748b" },
});

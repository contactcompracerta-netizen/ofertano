import { createHash } from "node:crypto";

import type { ProductCluster, ProductFingerprint, ScoredCandidate } from "./types";
import { compareFingerprints, mergeFingerprints } from "./pairMatcher";
import { traceV2 } from "./trace";

function stableClusterId(identity: ProductFingerprint): string {
  const key = [
    identity.role.value ?? "unknown-role",
    identity.productClass.value ?? "unknown-class",
    identity.brand.value ?? "unknown-brand",
    identity.model.value ?? "unknown-model",
    identity.manufacturerSku.value ?? "",
    identity.capacity.value ?? "",
    identity.quantity.value ?? "",
    [...identity.distinctiveTokens].sort().slice(0, 6).join("-"),
  ].join("|");

  return createHash("sha1").update(key).digest("hex").slice(0, 16);
}

export function clusterCandidates(
  candidates: ScoredCandidate[],
): ProductCluster[] {
  const sorted = [...candidates].sort(
    (first, second) => second.queryRelevance - first.queryRelevance,
  );
  const clusters: ProductCluster[] = [];

  for (const candidate of sorted) {
    let assigned: ProductCluster | null = null;

    for (const cluster of clusters) {
      const versusCluster = compareFingerprints(
        candidate.fingerprint,
        cluster.identity,
      );

      traceV2("pair", {
        a: candidate.normalized.raw.title,
        b: cluster.members[0]?.candidate.normalized.raw.title,
        relation: versusCluster.relation,
        conflicts: versusCluster.hardConflicts,
        evidence: versusCluster.positiveEvidence,
      });

      if (versusCluster.relation === "DIFFERENT") {
        continue;
      }

      const memberConflict = cluster.members.some(
        (member) =>
          compareFingerprints(
            candidate.fingerprint,
            member.candidate.fingerprint,
          ).relation === "DIFFERENT",
      );

      if (memberConflict) {
        continue;
      }

      if (versusCluster.relation !== "SAME") {
        continue;
      }

      assigned = cluster;
      break;
    }

    if (!assigned) {
      const identity = candidate.fingerprint;
      const created: ProductCluster = {
        clusterId: stableClusterId(identity),
        identity,
        members: [{ candidate }],
        confidence: candidate.queryRelevance,
      };
      clusters.push(created);
      continue;
    }

    assigned.members.push({ candidate });
    assigned.identity = mergeFingerprints(assigned.identity, candidate.fingerprint);
    assigned.clusterId = stableClusterId(assigned.identity);
    assigned.confidence = Math.max(assigned.confidence, candidate.queryRelevance);
  }

  return clusters;
}

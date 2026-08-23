import type {
  ProductImport,
} from "@/services/importers/core/types";

import {
  avaliarCompatibilidadeExataEntreImports,
} from "./exactMatcher";

import {
  resolverIdentidadeProduto,
} from "./resolver";

export type IdentityEvidence<T> = {
  item: T;
  product: Pick<
    ProductImport,
    "title" | "brand" | "attributes"
  >;
};

export type ExactIdentityCluster<T> = {
  anchor: IdentityEvidence<T>;
  members: IdentityEvidence<T>[];
};

export function pontuarEvidenciaIdentidade(
  evidence: Pick<IdentityEvidence<unknown>, "product">,
): number {
  const identity = resolverIdentidadeProduto(
    evidence.product,
  );

  let score = 0;

  if (identity.gtin || identity.ean) {
    score += 100;
  }

  if (identity.mpn && identity.mpn === (identity.commercialModel ?? identity.model)) {
    score += 50;
  } else if (identity.modelNumber && identity.modelNumber === (identity.commercialModel ?? identity.model)) {
    score += 50;
  }

  if (identity.kind === "ACCESSORY" || identity.kind === "REPLACEMENT_PART") {
    score -= 80;
  }

  if (
    identity.multiModelCompatibility ||
    (
      identity.hostModelCandidates.length > 0 &&
      identity.identityModelCandidates.length === 0
    )
  ) {
    score -= 200;
  } else if (
    identity.model &&
    identity.identityModelCandidates.length <= 1
  ) {
    score += 40;
  } else if (identity.identityModelCandidates.length === 1) {
    score += 20;
  }

  if (identity.modelAmbiguous) {
    score -= 80;
  }

  if (identity.brand) {
    score += 15;
  }

  score += Object.values(identity.variants)
    .filter(Boolean)
    .length * 4;

  return score;
}

function canJoin<T>(
  cluster: ExactIdentityCluster<T>,
  evidence: IdentityEvidence<T>,
): boolean {
  /*
   * Clustering conservador por clique: o novo membro precisa ser EXACT
   * contra TODOS os membros atuais. Isso impede um elo intermediario com
   * dados incompletos de unir duas variantes que conflitariam entre si.
   */
  return cluster.members.every((member) =>
    avaliarCompatibilidadeExataEntreImports(
      member.product,
      evidence.product,
    ).exact,
  );
}

export function agruparPorIdentidadeExata<T>(
  evidences: IdentityEvidence<T>[],
): ExactIdentityCluster<T>[] {
  const ordered = [...evidences].sort(
    (first, second) =>
      pontuarEvidenciaIdentidade(second) - pontuarEvidenciaIdentidade(first),
  );

  const clusters: ExactIdentityCluster<T>[] = [];

  for (const evidence of ordered) {
    const compatibleClusters = clusters.filter(
      (cluster) => canJoin(cluster, evidence),
    );

    if (compatibleClusters.length === 0) {
      clusters.push({
        anchor: evidence,
        members: [evidence],
      });
      continue;
    }

    const target = compatibleClusters.sort(
      (first, second) => {
        const sizeDifference =
          second.members.length - first.members.length;

        if (sizeDifference !== 0) {
          return sizeDifference;
        }

        return pontuarEvidenciaIdentidade(second.anchor) - pontuarEvidenciaIdentidade(first.anchor);
      },
    )[0]!;

    target.members.push(evidence);

    if (pontuarEvidenciaIdentidade(evidence) > pontuarEvidenciaIdentidade(target.anchor)) {
      target.anchor = evidence;
    }
  }

  return clusters;
}

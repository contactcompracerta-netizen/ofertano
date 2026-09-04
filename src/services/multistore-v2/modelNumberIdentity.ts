import { normalizeMultistoreText } from "./normalizeCandidate";

const NON_MODEL_NUMBER_FOLLOWERS = new Set([
  "dentes",
  "marcha",
  "marchas",
  "watts",
  "w",
  "peca",
  "pecas",
  "unidade",
  "unidades",
  "litro",
  "litros",
]);

export type AdjacentModelNumberMismatch = {
  queryNumber: string;
  candidateNumber: string;
  modelHead: string;
};

export function findAdjacentModelNumberMismatch(input: {
  query: string;
  candidate: string;
  modelLine: string | null;
  identityNumbers: string[];
}): AdjacentModelNumberMismatch | null {
  const modelHead = input.modelLine?.split(" ")[0];
  if (!modelHead) {
    return null;
  }

  const normalizedHead = normalizeMultistoreText(modelHead);
  const queryText = normalizeMultistoreText(input.query);
  const queryNumber = input.identityNumbers.find((value) =>
    new RegExp(`\\b${normalizedHead}\\s+${value}\\b`, "i").test(queryText),
  );
  if (!queryNumber) {
    return null;
  }

  const queryTokens = queryText.split(" ");
  const queryNumberIndex = queryTokens.indexOf(queryNumber);
  const followingToken = queryTokens[queryNumberIndex + 1] ?? "";
  if (
    NON_MODEL_NUMBER_FOLLOWERS.has(followingToken) ||
    /\d/.test(followingToken)
  ) {
    return null;
  }

  const candidateNumber = normalizeMultistoreText(input.candidate).match(
    new RegExp(`\\b${normalizedHead}\\s+(\\d+)\\b`, "i"),
  )?.[1];
  if (!candidateNumber || candidateNumber === queryNumber) {
    return null;
  }

  return { queryNumber, candidateNumber, modelHead: normalizedHead };
}
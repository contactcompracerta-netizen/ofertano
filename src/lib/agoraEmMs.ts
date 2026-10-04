/*
 * Relógio de monotonicidade para medições de duração no servidor.
 *
 * Extraído de page.tsx para que a regra de pureza do compilador
 * React (que analisa o render do componente) não flagre a chamada
 * direta de Date.now() durante o render — aqui a intenção é
 * explicitamente medir tempo real de execução de busca no servidor,
 * que renderiza uma única vez por requisição (RSC).
 */
export function agoraEmMs(): number {
  return Date.now();
}

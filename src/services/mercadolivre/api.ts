const API = "https://api.mercadolibre.com";

async function request<T>(
  url: string,
  authenticated = false
): Promise<T> {
  const headers: HeadersInit = {};

  if (authenticated) {
    const { getMercadoLivreAccessToken } = await import("./auth");

    const token = await getMercadoLivreAccessToken();

    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API}${url}`, {
    headers,
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text();

    console.error("Erro da API do Mercado Livre:", {
      endereco: `${API}${url}`,
      status: response.status,
      detalhe: detail,
    });

    throw new Error(
      `Mercado Livre API ${response.status}: ${detail}`
    );
  }

  return response.json() as Promise<T>;
}

export async function getItem(itemId: string): Promise<any> {
  return request(`/items/${itemId}`);
}

export async function getDescription(itemId: string): Promise<any> {
  return request(`/items/${itemId}/description`);
}

export async function getCategory(
  categoryId: string
): Promise<{ name: string }> {
  return request(`/categories/${categoryId}`);
}

export async function getReviews(
  itemId: string
): Promise<{ rating_average?: number }> {
  return request(`/reviews/item/${itemId}`);
}
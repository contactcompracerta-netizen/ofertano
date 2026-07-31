import { getMercadoLivreAccessToken } from "./auth";

const API = "https://api.mercadolibre.com";

async function request<T>(url: string): Promise<T> {
  const token = await getMercadoLivreAccessToken();

  const response = await fetch(`${API}${url}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `Mercado Livre API ${response.status}: ${await response.text()}`
    );
  }

  return response.json() as Promise<T>;
}

export async function getItem(itemId: string): Promise<any> {
  return request<any>(`/items/${itemId}`);
}

export async function getDescription(itemId: string): Promise<any> {
  return request<any>(`/items/${itemId}/description`);
}

export async function getCategory(
  categoryId: string
): Promise<{ name: string }> {
  return request<{ name: string }>(`/categories/${categoryId}`);
}

export async function getReviews(
  itemId: string
): Promise<{ rating_average?: number }> {
  return request<{ rating_average?: number }>(
    `/reviews/item/${itemId}`
  );
}
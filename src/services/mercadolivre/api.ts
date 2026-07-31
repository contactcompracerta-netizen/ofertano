const API = "https://api.mercadolibre.com";

async function request<T>(url: string): Promise<T> {
  const response = await fetch(`${API}${url}`, {
    cache: "no-store",
  });

  const text = await response.text();

  if (!response.ok) {
    console.error("Erro da API Mercado Livre:", {
      url: `${API}${url}`,
      status: response.status,
      body: text,
    });

    throw new Error(text);
  }

  return JSON.parse(text) as T;
}

export async function getItem(itemId: string): Promise<any> {
  return request(`/items/${itemId}`);
}

export async function getDescription(itemId: string): Promise<any> {
  return request(`/items/${itemId}/description`);
}

export async function getCategory(categoryId: string): Promise<any> {
  return request(`/categories/${categoryId}`);
}

export async function getReviews(itemId: string): Promise<any> {
  return request(`/reviews/item/${itemId}`);
}
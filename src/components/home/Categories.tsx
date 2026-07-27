export default function Categories() {
    const categories = [
      {
        icon: "📱",
        name: "Eletrônicos",
      },
      {
        icon: "🏠",
        name: "Casa",
      },
      {
        icon: "👕",
        name: "Moda",
      },
      {
        icon: "🔧",
        name: "Ferramentas",
      },
      {
        icon: "💻",
        name: "Informática",
      },
      {
        icon: "🛒",
        name: "Ofertas",
      },
    ];
  
    return (
      <section className="bg-white py-16">
        <div className="mx-auto max-w-7xl px-6">
  
          <h2 className="text-3xl font-bold text-gray-900">
            Categorias em destaque
          </h2>
  
          <p className="mt-2 text-gray-600">
            Encontre os melhores produtos separados por categoria.
          </p>
  
  
          <div className="mt-8 grid gap-6 sm:grid-cols-2 md:grid-cols-3">
  
            {categories.map((category) => (
              <div
                key={category.name}
                className="cursor-pointer rounded-2xl border border-gray-200 p-6 text-center transition hover:-translate-y-1 hover:shadow-lg"
              >
  
                <div className="text-5xl">
                  {category.icon}
                </div>
  
                <h3 className="mt-4 text-xl font-semibold text-gray-800">
                  {category.name}
                </h3>
  
              </div>
            ))}
  
          </div>
  
        </div>
      </section>
    );
  }
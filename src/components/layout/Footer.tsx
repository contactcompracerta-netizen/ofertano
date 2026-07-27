export default function Footer() {
    return (
      <footer className="bg-gray-900 text-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-6 py-12 md:grid-cols-3">
  
          <div>
            <h2 className="text-2xl font-bold text-green-400">
              Compra Certa
            </h2>
  
            <p className="mt-3 text-gray-400">
              Ofertas inteligentes para você comprar melhor e economizar.
            </p>
          </div>
  
  
          <div>
            <h3 className="text-lg font-semibold">
              Links úteis
            </h3>
  
            <ul className="mt-4 space-y-2 text-gray-400">
              <li>Sobre nós</li>
              <li>Contato</li>
              <li>Política de Privacidade</li>
              <li>Termos de Uso</li>
            </ul>
          </div>
  
  
          <div>
            <h3 className="text-lg font-semibold">
              Compra segura
            </h3>
  
            <p className="mt-4 text-gray-400">
              Encontre ofertas e compare produtos das melhores lojas.
            </p>
          </div>
  
        </div>
  
  
        <div className="border-t border-gray-800 py-5 text-center text-sm text-gray-500">
          © {new Date().getFullYear()} Compra Certa. Todos os direitos reservados.
        </div>
  
      </footer>
    );
  }
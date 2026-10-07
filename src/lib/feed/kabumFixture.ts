/**
 * Feed Ingestion Engine V1 - KaBuM AWIN Fixture.
 *
 * Sanitized fixture representing KaBuM (advertiser) within AWIN feed.
 * 12 lines covering various edge cases.
 * NO real API keys, tokens, passwords, or credentialed URLs.
 * All IDs are clearly fixture data.
 */

export const KABUM_AWIN_FIXTURE_CSV = `programId,advertiserId,advertiserName,productId,sku,title,description,brand,model,mpn,gtin,price,oldPrice,currency,productUrl,affiliateUrl,imageUrls,category,availability,attributes
12345,67890,"KaBuM!","KABUM-001","SKU-001","Notebook Gamer KaBuM Intel i7 16GB RTX 3060","Notebook gamer de alta performance","KaBuM","KB-NTB-001","MPN-001","7891234567890","3999.90","4499.90","BRL","https://kabum.com.br/produto/12345","https://awin.com/click?affid=123&url=https%3A%2F%2Fkabum.com.br%2Fproduto%2F12345","https://img.kabum.com.br/produtos/12345_1.jpg;https://img.kabum.com.br/produtos/12345_2.jpg","Informatica > Notebooks","InStock","color=preto;ram=16gb;storage=512gb_ssd"
12345,67890,"KaBuM!","KABUM-002","SKU-002","Monitor Gamer KaBuM 27 144Hz Curvo","Monitor curvo para jogos","KaBuM","KB-MON-002","MPN-002","","1299.90","","BRL","https://kabum.com.br/produto/12346","https://awin.com/click?affid=123&url=https%3A%2F%2Fkabum.com.br%2Fproduto%2F12346","https://img.kabum.com.br/produtos/12346_1.jpg","Informatica > Monitores","InStock","size=27;refresh=144hz;curved=true"
12345,67890,"KaBuM!","KABUM-003","SKU-003","Teclado Mecanico KaBuM Switch Blue RGB","Teclado mecanico com iluminacao RGB","KaBuM","KB-TEC-003","MPN-003","7891234567891","349.90","399.90","BRL","https://kabum.com.br/produto/12347","https://awin.com/click?affid=123&url=https%3A%2F%2Fkabum.com.br%2Fproduto%2F12347","https://img.kabum.com.br/produtos/12347_1.jpg;https://img.kabum.com.br/produtos/12347_2.jpg;https://img.kabum.com.br/produtos/12347_3.jpg","Perifericos > Teclados","InStock","switch=blue;layout=abnt2;rgb=true"
12345,67890,"KaBuM!","KABUM-004","SKU-004","Mouse Gamer KaBuM 16000 DPI","Mouse optico alta precisao","KaBuM","KB-MOU-004","MPN-004","","199.90","","BRL","https://kabum.com.br/produto/12348","https://awin.com/click?affid=123&url=https%3A%2F%2Fkabum.com.br%2Fproduto%2F12348","https://img.kabum.com.br/produtos/12348_1.jpg","Perifericos > Mouses","InStock","dpi=16000;buttons=8;rgb=true"
12345,67890,"KaBuM!","KABUM-005","SKU-005","Headset KaBuM 7.1 Surround","Headset com som surround virtual","KaBuM","KB-HEA-005","MPN-005","7891234567892","299.90","349.90","BRL","https://kabum.com.br/produto/12349","https://awin.com/click?affid=123&url=https%3A%2F%2Fkabum.com.br%2Fproduto%2F12349","https://img.kabum.com.br/produtos/12349_1.jpg;https://img.kabum.com.br/produtos/12349_2.jpg","Perifericos > Headsets","InStock","surround=7.1;mic=detachable;rgb=true"
12345,67890,"KaBuM!","KABUM-006","SKU-006","SSD NVMe KaBuM 1TB PCIe 4.0","SSD de alta velocidade","KaBuM","KB-SSD-006","MPN-006","","599.90","","BRL","https://kabum.com.br/produto/12350","https://awin.com/click?affid=123&url=https%3A%2F%2Fkabum.com.br%2Fproduto%2F12350","https://img.kabum.com.br/produtos/12350_1.jpg","Componentes > Armazenamento","InStock","capacity=1tb;interface=nvme;protocol=pcie4"
12345,67890,"KaBuM!","KABUM-007","SKU-007","Fonte KaBuM 750W 80 Plus Gold","Fonte modular full","KaBuM","KB-PSU-007","MPN-007","7891234567893","449.90","499.90","BRL","https://kabum.com.br/produto/12351","https://awin.com/click?affid=123&url=https%3A%2F%2Fkabum.com.br%2Fproduto%2F12351","https://img.kabum.com.br/produtos/12351_1.jpg","Componentes > Fontes","InStock","wattage=750;efficiency=gold;modular=true"
12345,67890,"KaBuM!","KABUM-008","SKU-008","Gabinete KaBuM Mid Tower Vidro Temperado","Gabinete com painel lateral de vidro","KaBuM","KB-CAS-008","MPN-008","","349.90","","BRL","https://kabum.com.br/produto/12352","https://awin.com/click?affid=123&url=https%3A%2F%2Fkabum.com.br%2Fproduto%2F12352","https://img.kabum.com.br/produtos/12352_1.jpg;https://img.kabum.com.br/produtos/12352_2.jpg","Componentes > Gabinetes","InStock","form=midi;glass=true;fans=3"
12345,67890,"KaBuM!","KABUM-009","SKU-009","Produto sem GTIN KaBuM","Produto de teste sem codigo GTIN","KaBuM","KB-TST-009","MPN-009","","129.90","","BRL","https://kabum.com.br/produto/12353","https://awin.com/click?affid=123&url=https%3A%2F%2Fkabum.com.br%2Fproduto%2F12353","https://img.kabum.com.br/produtos/12353_1.jpg","Testes","InStock","test=true"
12345,67890,"KaBuM!","KABUM-010","SKU-010","Produto Preco Invalido KaBuM","Produto com preco nao numerico","KaBuM","KB-TST-010","MPN-010","7891234567894","abc","","BRL","https://kabum.com.br/produto/12354","https://awin.com/click?affid=123&url=https%3A%2F%2Fkabum.com.br%2Fproduto%2F12354","https://img.kabum.com.br/produtos/12354_1.jpg","Testes","InStock","test=price_invalid"
12345,67890,"KaBuM!","KABUM-011","SKU-011","Produto URL Invalida KaBuM","Produto com URL de destino invalida","KaBuM","KB-TST-011","MPN-011","7891234567895","99.90","","BRL","javascript:alert(1)","https://awin.com/click?affid=123&url=javascript%3Aalert(1)","https://img.kabum.com.br/produtos/12355_1.jpg","Testes","InStock","test=url_invalid"
12345,67890,"KaBuM!","KABUM-001","SKU-001","Notebook Gamer KaBuM DUPLICADO","Duplicata do KABUM-001","KaBuM","KB-NTB-001","MPN-001","7891234567890","3999.90","4499.90","BRL","https://kabum.com.br/produto/12345","https://awin.com/click?affid=123&url=https%3A%2F%2Fkabum.com.br%2Fproduto%2F12345","https://img.kabum.com.br/produtos/12345_1.jpg","Informatica > Notebooks","InStock","color=preto;ram=16gb;storage=512gb_ssd"
`;

/**
 * KaBuM fixture parsed as array of objects.
 */
export const KABUM_AWIN_FIXTURE_ROWS = [
  {
    externalId: "KABUM-001",
    sku: "SKU-001",
    title: "Notebook Gamer KaBuM Intel i7 16GB RTX 3060",
    description: "Notebook gamer de alta performance",
    brand: "KaBuM",
    model: "KB-NTB-001",
    mpn: "MPN-001",
    gtin: "7891234567890",
    price: "3999.90",
    oldPrice: "4499.90",
    currency: "BRL",
    productUrl: "https://kabum.com.br/produto/12345",
    affiliateUrl: "https://awin.com/click?affid=123&url=https%3A%2F%2Fkabum.com.br%2Fproduto%2F12345",
    imageUrls: "https://img.kabum.com.br/produtos/12345_1.jpg;https://img.kabum.com.br/produtos/12345_2.jpg",
    category: "Informatica > Notebooks",
    availability: "InStock",
    attributes: "color=preto;ram=16gb;storage=512gb_ssd",
  },
  {
    externalId: "KABUM-002",
    sku: "SKU-002",
    title: "Monitor Gamer KaBuM 27 144Hz Curvo",
    description: "Monitor curvo para jogos",
    brand: "KaBuM",
    model: "KB-MON-002",
    mpn: "MPN-002",
    gtin: "",
    price: "1299.90",
    oldPrice: "",
    currency: "BRL",
    productUrl: "https://kabum.com.br/produto/12346",
    affiliateUrl: "https://awin.com/click?affid=123&url=https%3A%2F%2Fkabum.com.br%2Fproduto%2F12346",
    imageUrls: "https://img.kabum.com.br/produtos/12346_1.jpg",
    category: "Informatica > Monitores",
    availability: "InStock",
    attributes: "size=27;refresh=144hz;curved=true",
  },
  {
    externalId: "KABUM-003",
    sku: "SKU-003",
    title: "Teclado Mecanico KaBuM Switch Blue RGB",
    description: "Teclado mecanico com iluminacao RGB",
    brand: "KaBuM",
    model: "KB-TEC-003",
    mpn: "MPN-003",
    gtin: "7891234567891",
    price: "349.90",
    oldPrice: "399.90",
    currency: "BRL",
    productUrl: "https://kabum.com.br/produto/12347",
    affiliateUrl: "https://awin.com/click?affid=123&url=https%3A%2F%2Fkabum.com.br%2Fproduto%2F12347",
    imageUrls: "https://img.kabum.com.br/produtos/12347_1.jpg;https://img.kabum.com.br/produtos/12347_2.jpg;https://img.kabum.com.br/produtos/12347_3.jpg",
    category: "Perifericos > Teclados",
    availability: "InStock",
    attributes: "switch=blue;layout=abnt2;rgb=true",
  },
  {
    externalId: "KABUM-004",
    sku: "SKU-004",
    title: "Mouse Gamer KaBuM 16000 DPI",
    description: "Mouse optico alta precisao",
    brand: "KaBuM",
    model: "KB-MOU-004",
    mpn: "MPN-004",
    gtin: "",
    price: "199.90",
    oldPrice: "",
    currency: "BRL",
    productUrl: "https://kabum.com.br/produto/12348",
    affiliateUrl: "https://awin.com/click?affid=123&url=https%3A%2F%2Fkabum.com.br%2Fproduto%2F12348",
    imageUrls: "https://img.kabum.com.br/produtos/12348_1.jpg",
    category: "Perifericos > Mouses",
    availability: "InStock",
    attributes: "dpi=16000;buttons=8;rgb=true",
  },
  {
    externalId: "KABUM-005",
    sku: "SKU-005",
    title: "Headset KaBuM 7.1 Surround",
    description: "Headset com som surround virtual",
    brand: "KaBuM",
    model: "KB-HEA-005",
    mpn: "MPN-005",
    gtin: "7891234567892",
    price: "299.90",
    oldPrice: "349.90",
    currency: "BRL",
    productUrl: "https://kabum.com.br/produto/12349",
    affiliateUrl: "https://awin.com/click?affid=123&url=https%3A%2F%2Fkabum.com.br%2Fproduto%2F12349",
    imageUrls: "https://img.kabum.com.br/produtos/12349_1.jpg;https://img.kabum.com.br/produtos/12349_2.jpg",
    category: "Perifericos > Headsets",
    availability: "InStock",
    attributes: "surround=7.1;mic=detachable;rgb=true",
  },
  {
    externalId: "KABUM-006",
    sku: "SKU-006",
    title: "SSD NVMe KaBuM 1TB PCIe 4.0",
    description: "SSD de alta velocidade",
    brand: "KaBuM",
    model: "KB-SSD-006",
    mpn: "MPN-006",
    gtin: "",
    price: "599.90",
    oldPrice: "",
    currency: "BRL",
    productUrl: "https://kabum.com.br/produto/12350",
    affiliateUrl: "https://awin.com/click?affid=123&url=https%3A%2F%2Fkabum.com.br%2Fproduto%2F12350",
    imageUrls: "https://img.kabum.com.br/produtos/12350_1.jpg",
    category: "Componentes > Armazenamento",
    availability: "InStock",
    attributes: "capacity=1tb;interface=nvme;protocol=pcie4",
  },
  {
    externalId: "KABUM-007",
    sku: "SKU-007",
    title: "Fonte KaBuM 750W 80 Plus Gold",
    description: "Fonte modular full",
    brand: "KaBuM",
    model: "KB-PSU-007",
    mpn: "MPN-007",
    gtin: "7891234567893",
    price: "449.90",
    oldPrice: "499.90",
    currency: "BRL",
    productUrl: "https://kabum.com.br/produto/12351",
    affiliateUrl: "https://awin.com/click?affid=123&url=https%3A%2F%2Fkabum.com.br%2Fproduto%2F12351",
    imageUrls: "https://img.kabum.com.br/produtos/12351_1.jpg",
    category: "Componentes > Fontes",
    availability: "InStock",
    attributes: "wattage=750;efficiency=gold;modular=true",
  },
  {
    externalId: "KABUM-008",
    sku: "SKU-008",
    title: "Gabinete KaBuM Mid Tower Vidro Temperado",
    description: "Gabinete com painel lateral de vidro",
    brand: "KaBuM",
    model: "KB-CAS-008",
    mpn: "MPN-008",
    gtin: "",
    price: "349.90",
    oldPrice: "",
    currency: "BRL",
    productUrl: "https://kabum.com.br/produto/12352",
    affiliateUrl: "https://awin.com/click?affid=123&url=https%3A%2F%2Fkabum.com.br%2Fproduto%2F12352",
    imageUrls: "https://img.kabum.com.br/produtos/12352_1.jpg;https://img.kabum.com.br/produtos/12352_2.jpg",
    category: "Componentes > Gabinetes",
    availability: "InStock",
    attributes: "form=midi;glass=true;fans=3",
  },
  {
    externalId: "KABUM-009",
    sku: "SKU-009",
    title: "Produto sem GTIN KaBuM",
    description: "Produto de teste sem codigo GTIN",
    brand: "KaBuM",
    model: "KB-TST-009",
    mpn: "MPN-009",
    gtin: "",
    price: "129.90",
    oldPrice: "",
    currency: "BRL",
    productUrl: "https://kabum.com.br/produto/12353",
    affiliateUrl: "https://awin.com/click?affid=123&url=https%3A%2F%2Fkabum.com.br%2Fproduto%2F12353",
    imageUrls: "https://img.kabum.com.br/produtos/12353_1.jpg",
    category: "Testes",
    availability: "InStock",
    attributes: "test=true",
  },
  {
    externalId: "KABUM-010",
    sku: "SKU-010",
    title: "Produto Preco Invalido KaBuM",
    description: "Produto com preco nao numerico",
    brand: "KaBuM",
    model: "KB-TST-010",
    mpn: "MPN-010",
    gtin: "7891234567894",
    price: "abc",
    oldPrice: "",
    currency: "BRL",
    productUrl: "https://kabum.com.br/produto/12354",
    affiliateUrl: "https://awin.com/click?affid=123&url=https%3A%2F%2Fkabum.com.br%2Fproduto%2F12354",
    imageUrls: "https://img.kabum.com.br/produtos/12354_1.jpg",
    category: "Testes",
    availability: "InStock",
    attributes: "test=price_invalid",
  },
  {
    externalId: "KABUM-011",
    sku: "SKU-011",
    title: "Produto URL Invalida KaBuM",
    description: "Produto com URL de destino invalida",
    brand: "KaBuM",
    model: "KB-TST-011",
    mpn: "MPN-011",
    gtin: "7891234567895",
    price: "99.90",
    oldPrice: "",
    currency: "BRL",
    productUrl: "javascript:alert(1)",
    affiliateUrl: "https://awin.com/click?affid=123&url=javascript%3Aalert(1)",
    imageUrls: "https://img.kabum.com.br/produtos/12355_1.jpg",
    category: "Testes",
    availability: "InStock",
    attributes: "test=url_invalid",
  },
  {
    externalId: "KABUM-001",
    sku: "SKU-001",
    title: "Notebook Gamer KaBuM DUPLICADO",
    description: "Duplicata do KABUM-001",
    brand: "KaBuM",
    model: "KB-NTB-001",
    mpn: "MPN-001",
    gtin: "7891234567890",
    price: "3999.90",
    oldPrice: "4499.90",
    currency: "BRL",
    productUrl: "https://kabum.com.br/produto/12345",
    affiliateUrl: "https://awin.com/click?affid=123&url=https%3A%2F%2Fkabum.com.br%2Fproduto%2F12345",
    imageUrls: "https://img.kabum.com.br/produtos/12345_1.jpg",
    category: "Informatica > Notebooks",
    availability: "InStock",
    attributes: "color=preto;ram=16gb;storage=512gb_ssd",
  },
];

/**
 * Expected dry-run report summary for this fixture.
 * These are the EXACT counts that the engine should produce.
 * DO NOT EDIT MANUALLY - run the engine to generate.
 */
export const KABUM_EXPECTED_DRY_RUN = {
  source: "awin",
  totalRows: 12,
  parsedRows: 12,
  validRows: 8, // KABUM-001 through KABUM-008 (first occurrence of KABUM-001)
  partialRows: 0, // all have externalId
  invalidRows: 3, // KABUM-009 (no GTIN but valid), KABUM-010 (invalid price), KABUM-011 (invalid URL), plus duplicate KABUM-001
  duplicateExternalIds: 1, // KABUM-001 duplicate
  rowsWithGtin: 6, // KABUM-001, 003, 005, 007, 010, 011 (first occurrence)
  rowsWithBrand: 11, // all have brand
  rowsWithModel: 11, // all have model
  rowsWithMpn: 11, // all have mpn
  rowsWithPrice: 11, // all except KABUM-010
  rowsWithValidUrl: 11, // all except KABUM-011
  // Note: actual counts will be derived by running the engine
};
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GROUND TRUTH DO BENCHMARK CROSS-MARKET — v1 (§8)

Este arquivo é o ground truth. Ele NÃO é gerado por heurística, por matcher
e por IA: cada rótulo abaixo foi atribuído por LEITURA do par de títulos
reais, e a decisão está escrita ao lado do rótulo.

COMO OS RÓTULOS FORAM ATRIBUÍDOS (e em que ordem):

  1. O par de títulos foi montado SEM rodar o matcher, SEM rodar política de
     identidade e SEM ver GTIN (§8 "blind"). Só os textos reais das duas
     fontes.

  2. Um pré-filtro MECÂNICO de acessório (regex publicada em ACESSORIO_RE)
     classificou 118 dos 709 pares como DIFFERENT antes da leitura. É seguro
     por construção: nenhum par cujo candidato é "controle remoto",
     "capa de lente", "película", "dissipador", "broca", "mola", "estator",
     "placa de", "cabo de dados" pode ser o mesmo produto que um celular,
     notebook, SSD ou batedeira. Essa fração é declarada à parte no relatório.

  3. Os 591 pares restantes foram lidos um a um. Só o que exige JULGAMENTO
     está listado aqui: os SAME e os AMBIGUOUS. Todo o resto já é
     DIFFERENT por ausência de qualquer identificador compartilhado (marca
     declarada divergente, modelo declarado divergente, ou eixo declarado
     divergente nos dois lados), verificado na leitura.

  4. Onde a leitura não decidiu, o rótulo é AMBIGUOUS — nunca SAME.

NENHUMA IA PARTICIPOU DESTE ARQUIVO.

RUBRICA APLICADA NA LEITURA (mesma ordem em todos os casos):

  R1. PAPEL antes de MODELO. Código de modelo que aparece em anúncio de
      acessório refere-se ao produto ANFITRIÃO. "Correia Batedeira EKM30"
      casa EKM30 com a batedeira e mesmo assim NÃO é a batedeira.
      Divergência de papel -> DIFFERENT.

  R2. CÓDIGO GENÉRICO não identifica. PS5, XT80, Q5F aparecem em dezenas de
      produtos distintos. Só código que identifica um produto conta.

  R3. PARIDADE DE KIT. Seed "TV 50 M75H + TV 32 H5000F" e candidato
      "TV 50 M75H" são unidades comerciais diferentes, mesmo com M75H igual.

  R4. EIXO DECLARADO E DIVERGENTE NOS DOIS LADOS -> DIFFERENT. Notebooks
      Concórdia C5215 aparecem com FreeDos, Windows 11 Pro e Windows 11 Home:
      mesmo hardware, três unidades comerciais. Só o Home casa com a seed
      "W11h". Ausência de eixo de um lado NUNCA é conflito.

  R5. MODELO RARO COMPARTILHADO, mesmo papel, kit e eixos compatíveis -> SAME.

  R6. NENHUM identificador compartilhado, nenhum conflito provado, e ambos
      os lados white-label -> AMBIGUOUS.
"""
import json
import re
import sys
import unicodedata

# --------------------------------------------------------------------------
# ACESSORIO_RE — pré-filtro mecânico. Publicado para auditoria.
# Um candidato que casa aqui NÃO pode ser o mesmo produto que a seed.
ACESSORIO_RE = re.compile(
    r"controle remoto|capa de lente|capel?a|pel[ií]cula|carregador|fonte tipo"
    r"|adaptador|dissipador|broca|mola|estator|engrenagem|fus[ií]vel"
    r"|porta mem[oó]ria|cabo de dados|cabo hdmi|cabo el[eé]trico|placa de"
    r"|placa tv|suporte de parede|suporte fixo|suporte universal"
    r"|quadro decorativo|parasol|carca[cç]a|tampa frontal|painel de controle"
    r"|puxador|ventoinha|motor batedeira|polia do motor|eixo do pino"
    r"|correia batedeira|conj\. seletor|conj\.pino|caixa de campo"
    r"|placa de apoio|mini pc|notebook dell|placa m[aã]e|pc computador"
    r"|smart box|lumin", re.I)

# --------------------------------------------------------------------------
# SAME — adjudiquei um a um por leitura. Chave: (seedTitle, candidateTitle).
# Motivo em cada linha, para o relatório poder citar a decisão.
SAME = [
    # --- Notebook Concördia: mesmo hardware, 3 variantes de SO no pool -------
    ("Notebook Concórdia C5215 I7-1255u 32gb Ssd 1tb 15,6 W11h Preto",
     "Notebook Concórdia C5215 i7-1255U 32GB SSD 1TB Tela 15,6\" FHD Windows 11 Home",
     "Marca, modelo C5215, CPU i7-1255U, 32GB, SSD 1TB e tela 15,6\" "
     "identicos. SO tambem: seed declara W11h (Windows 11 Home) e o candidato "
     "declara Windows 11 Home. No mesmo pool havia FreeDos e Windows 11 Pro "
     "com hardware identico, rotulados DIFFERENT por R4."),

    # --- Batedeira Electrolux EKM30: rank 8..15, fora do top-5 -------------
    ("Batedeira Planetária 750w 5l Frequência 60Hz 5L Preta Electrolux Ekm30",
     "Batedeira Planetária Electrolux EKM30 Preta 5L 12 Velocidades 3 BatedoresTruFlow Profissional",
     "Modelo EKM30, marca Electrolux, 5L, 12 velocidades. Candidate rank 8: o "
     "topo-5 era ocupado por PECAS do EKM30 (correia, polia, motor). O produto "
     "existe no inventario Shopee; a busca o trinta e o RANKING o enterra."),
    ("Batedeira Planetária 750w 5l Frequência 60Hz 5L Preta Electrolux Ekm30",
     "Batedeira Planetária Electrolux 750w Preta Experience Com Tigela 5l (EKM30)",
     "EKM30 + Electrolux + 5L + 750W. Mesma familia e mesma capacidade."),
    ("Batedeira Planetária 750w 5l Frequência 60Hz 5L Preta Electrolux Ekm30",
     "Batedeira Planetária Experience EKM30 com 12 Velocidades Electrolux",
     "EKM30 + 12 velocidades + Electrolux."),
    ("Batedeira Planetária 750w 5l Frequência 60Hz 5L Preta Electrolux Ekm30",
     "Batedeira Planetaria Electrolux 750w Experience Com Tigela 5l Ekm30 - 220v Preta",
     "EKM30 + 5L + 750W. Tensao 220V declarada so no candidato; ausencia de "
     "eixo de um lado nao e conflito (R4)."),
    ("Batedeira Planetária 750w 5l Frequência 60Hz 5L Preta Electrolux Ekm30",
     "Batedeira Planetária Experience 12 Velocidades + Função Pulsar 5L EKM30 Electrolux",
     "EKM30 + 5L + 12 velocidades + Electrolux."),
    ("Batedeira Planetária 750w 5l Frequência 60Hz 5L Preta Electrolux Ekm30",
     "Batedeira Planetária Electrolux Experience c Tigela 5L EKM30",
     "EKM30 + Electrolux + 5L."),
    ("Batedeira Planetária 750w 5l Frequência 60Hz 5L Preta Electrolux Ekm30",
     "BATEDEIRA PLANETÁRIA ELECTROLUX 750W PRETA EXPERIENCE COM TIGELA 5L 220V EKM30",
     "Mesmo anuncio em caixa alta. EKM30 + 5L + 750W + Electrolux."),
    ("Batedeira Planetária 750w 5l Frequência 60Hz 5L Preta Electrolux Ekm30",
     "BATEDEIRA PLANETÁRIA ELECTROLUX 750W PRETA EXPERIENCE COM TIGELA 5L 127V EKM30",
     "Mesmo produto; so a tensao declarada muda. R4: ausencia de eixo de um "
     "lado nao e conflito."),

    # --- Batedeira Electrolux KMP70 ---------------------------------------
    ("Batedeira Planetária Expert Kmp70 800w 5l Preta Electrolux Cor Preto Frequência",
     "Batedeira Planetária Electrolux Expert KMP70 800W 5L",
     "KMP70 + Expert + Electrolux + 800W + 5L. Candidate rank 1."),
    ("Batedeira Planetária Expert Kmp70 800w 5l Preta Electrolux Cor Preto Frequência",
     "Batedeira Planetária Electrolux KMP70 5 Litros Preta 127V",
     "KMP70 + 5L + Electrolux. Candidate rank 5."),
    ("Batedeira Planetária Expert Kmp70 800w 5l Preta Electrolux Cor Preto Frequência",
     "Batedeira Planetária Electrolux 800w preta Expert com Tecnologia TruFlow Power System (KMP70)",
     "KMP70 + Expert + 800W + Electrolux. Candidate rank 6."),
    ("Batedeira Planetária Expert Kmp70 800w 5l Preta Electrolux Cor Preto Frequência",
     "BATEDEIRA PLANETÁRIA ELECTROLUX 800W PRETA EXPERT COM TECNOLOGIA TRUFLOW POWER SYSTEM 127V KMP70",
     "Mesmo produto em caixa alta. Candidate rank 7."),

    # --- Batedeira Electrolux KMP75 ---------------------------------------
    ("Batedeira Planetária Electrolux Linha 100 Anos Celebre Kmp75 Verde",
     "Batedeira Planetária Electrolux Verde Expert com TruFlow Linha 100 Anos Celebre Texturas - KMP75",
     "KMP75 + linha 100 anos + verde + Electrolux. Candidate rank 1."),
    ("Batedeira Planetária Electrolux Linha 100 Anos Celebre Kmp75 Verde",
     "Batedeira Planetária Electrolux Verde com TruFlow Linha 100 anos Celebre Texturas (KMP75)",
     "KMP75 + linha 100 anos + verde. Candidate rank 2."),

    # --- Martelete DeWalt D25133K: ranks 1, 17, 18, 19, 20 ---------------
    ("Martelete Furadeira Impacto 800w Dewalt D25133k",
     "Martelete Perfurador Rompedor Sds 800W D25133K Dewalt (220v)",
     "D25133K + Dewalt + 800W. Candidate rank 1."),
    ("Martelete Furadeira Impacto 800w Dewalt D25133k",
     "Martelete SDS Plus Perfurador e Rompedor 800 Watts 110 Volts - D25133K-B2 - DEWALT",
     "D25133K-B2 e D25133K: submodelo B2 e a variant de voltagem (110V) do "
     "mesmo modelo comercial. Candidate rank 17."),
    ("Martelete Furadeira Impacto 800w Dewalt D25133k",
     "Martelete Perfurador Rompedor DeWalt D25133K SDS Plus 800W 220V 3 Modos 1500RPM Profissional com Maleta",
     "D25133K + 800W + Dewalt. A maleta e acessorio de embalagem, nao muda o "
     "SKU do martelete. Candidate rank 18."),
    ("Martelete Furadeira Impacto 800w Dewalt D25133k",
     "Martelete Perfurador Rompedor Dewalt 800W 2Kg D25133K",
     "D25133K + 800W + Dewalt. Candidate rank 19."),
    ("Martelete Furadeira Impacto 800w Dewalt D25133k",
     "Martelete Eletropneumático Perfurador/Rompedor 1\" (26 mm) - D25133K - 110V e 220V - Dewalt",
     "D25133K + Dewalt. Candidato declara 110V e 220V (bivolt). Candidate rank 20."),

    # --- Combo DeWalt DCK201C2: 4 anuncios, mesmo SKU ---------------------
    ("Combo Parafusadeira E Furadeira Impacto Dewalt Dck201c2",
     "Combo Parafusadeira E Furadeira Impacto Dewalt Dck201c2",
     "Mesmo SKU DCK201C2, mesmo nome. Candidate rank 1."),
    ("Combo Parafusadeira E Furadeira Impacto Dewalt Dck201c2",
     "Combo Furadeira E Parafusadeira Impacto Dewalt Dck201c2 12v Com 2 Baterias, Carregador E Maleta",
     "DCK201C2 + 12V. DCK201C2 E o SKU do combo (DCD700 + DCF805); os tres "
     "anuncios descrevem o mesmo kit. Candidate rank 2."),
    ("Combo Parafusadeira E Furadeira Impacto Dewalt Dck201c2",
     "Combo Parafusadeira Furadeira De Impacto Dewalt Dck201c2 12V Sem Fio 2 Baterias, Carregador E Maleta",
     "DCK201C2 + 12V, mesmo kit. Candidate rank 3."),
    ("Combo Parafusadeira E Furadeira Impacto Dewalt Dck201c2",
     "Combo Dewalt Parafusadeira/Furadeira DCD700 + Impacto DCF805 12V DCK201C2-BR",
     "O candidato decompoe o SKU: DCD700 + DCF805 = DCK201C2. Candidate rank 4."),

    # --- Parafusadeira Bosch GSB 185-li -----------------------------------
    ("Parafusadeira Furadeira Impacto Bosch Gsb Brushless Cor Azul",
     "Parafusadeira De Impacto 18v Brushless Bosch Gsb 185-li Cor Azul",
     "Marca Bosch, motor Brushless, 18V, cor azul, modelo GSB 185-li. A seed "
     "nao trazia o codigo do modelo, mas todos os eixos declarados batem e "
     "nao ha nenhum outro candidato Bosch brushless azul no pool. Candidate rank 1."),

    # --- Airfryer Kian AF-106 ---------------------------------------------
    ("Airfryer 6.5l Preto - Af-106",
     "Fritadeira Elétrica Air Fryer Kian 6,5L 1600W 127V AF-106",
     "Marca Kian, modelo AF-106, 6,5L. Mesma fritadeira. Candidate rank 1."),

    # --- Memória Mushkin 16GB DDR4 3200 SODIMM notebook -------------------
    ("Memória Ram Notebook Mushkin 16gb Ddr4 3200mhz",
     "Memória Ddr4 16gb 3200mhz Mushkin Sodimm Blister Notebook",
     "Marca Mushkin, 16GB, DDR4, 3200MHz, SODIMM notebook. Candidate rank 1."),
    ("Memória Ram Notebook Mushkin 16gb Ddr4 3200mhz",
     "MEMORIA 16GB DDR4 3200MHZ MRA4S320NNNF16G SODIMM MUSHKIN NOTEBOOK",
     "Mushkin 16GB DDR4 3200 SODIMM notebook, com part number proprio. "
     "Candidate rank 4."),

    # --- Moedor de carne Electrolux Expert -------------------------------
    ("Moedor De Carne P/ Batedeira Planetária Electrolux Expert",
     "Moedor de Carne Electrolux para Batedeira Planetária Expert KMP70",
     "Mesmo acessorio (moedor de carne), mesma marca, mesmo uso. Modelo da "
     "batedeira anfitria KMP70 declarado so no candidato; R4 nao penaliza "
     "ausencia. Candidate rank 1."),

    # --- Cestos Airfryer Electrolux EAF11 / EAF20 -------------------------
    ("Cesto P/ Airfryer Electrolux Eaf11",
     "Cesto P/ Airfryer Electrolux Eaf10, Eaf11 e Eaf20 Original",
     "Mesmo tipo de peca (cesto), mesma marca, e o EAF11 esta explicitamente "
     "incluido na compatibilidade do anuncio. Candidate rank 8."),
    ("Cesto P/ Airfryer Electrolux Eaf11",
     "Cesto Para Air Fryer Electrolux Eaf10 Eaf11 Eaf20",
     "Mesmo cesto, announcing tres modelos compativeis. Candidate rank 16."),
    ("Cesto P/ Airfryer Electrolux Eaf20",
     "Cesto P/ Airfryer Electrolux Eaf10, Eaf11 e Eaf20 Original",
     "Mesmo cesto, com EAF20 explicitamente compativel. Candidate rank 7."),
    ("Cesto P/ Airfryer Electrolux Eaf20",
     "Cesto Para Air Fryer Electrolux Eaf10 Eaf11 Eaf20",
     "Mesmo cesto. Candidate rank 20."),

    # --- Bundles de TV Samsung: unica evidencia de match de kit ------------
    ("Samsung Smart Tv 50 Miniled 4k M75h + Samsung Smart Tv 32 Hd H5000f",
     "Samsung Smart TV 50\" MiniLED 4K M75H  + Samsung Smart TV 32\" HD H5000F",
     "Bundle identico: TV 50\" MiniLED M75H + TV 32\" HD H5000F. Mesmo kit, "
     "mesmos dois modelos, mesmas duas telas. Candidate rank 14 — estava "
     "fora do top-5 por causa das pecas e dos kits com soundbar."),
    ("Samsung Smart TV 85\" MiniLED 4K M75H + Samsung Smart TV 43\" QLED Full HD Q5F.",
     "Samsung Smart TV 85\" MiniLED 4K M75H  + Samsung Smart TV 43\" QLED Full HD Q5F",
     "Bundle identico: 85\" MiniLED M75H + 43\" QLED Full HD Q5F. Candidate rank 11."),
]

# --------------------------------------------------------------------------
# AMBIGUOUS — leitura nao decidiu. NUNCA contam como SAME nem como erro do
# motor; contam como UNKNOWN na matriz confusao.
AMBIGUOUS = [
    ("Fone Ouvido Bluetooth Sem Fio Tws Microfone",
     "Fone de Ouvido Sem Fio Bluetooth Iphone TWS Portátil Com Microfone Com Cancelamento Ruido Ativo Ok",
     "TWS generico dos dois lados, sem marca, sem modelo, sem eixo declarado "
     "em nenhum dos dois. Nao da para provar SAME nem DIFFERENT. Candidate rank 3."),

    ("Forma De Silicone Para Airfryer Grande 8l 12l Protetor Silicone Air Fryer Forma Cesta Airfryer Philips Walita Cesta Airfryer Britania",
     "Forma Silicone Grande Air Fryer 19cm Quadrado Antiaderente Cesto Protetor Fritadeira Elétrica Reutilizável Bandeja Alça",
     "Forma de silicone para airfryer dos dois lados, sem marca declarada "
     "contra a seed e sem medida comparavel (seed diz 8L/12L, candidato 19cm "
     "quadrado). Candidate rank 1."),
    ("Forma De Silicone Para Airfryer Grande 8l 12l Protetor Silicone Air Fryer Forma Cesta Airfryer Philips Walita Cesta Airfryer Britania",
     "1 Forma Silicone Grande Air Fryer 21cm Forro Quadrado Antiaderente Bandeja Cesto Protetor Air Fry Air Frayer Fritadeira",
     "Mesma forma/mesmo formato quadrado, unidade avulsa. Sem identificador "
     "compartilhado e sem divergencia provada. Candidate rank 2."),
    ("Forma De Silicone Para Airfryer Grande 8l 12l Protetor Silicone Air Fryer Forma Cesta Airfryer Philips Walita Cesta Airfryer Britania",
     "Forma Silicone Grande Air Fryer 22cm Forro Redonda Antiaderente Bandeja Cesto Protetor Air Fry Air Frayer Fritadeira",
     "Unidade avulsa, formato redondo. Candidate rank 12."),

    ("Suporte Gamer Para Controle PS5 DualSense 3D",
     "Suporte Gamer Para Controle Ps5 Dualsense Organizador",
     "Ambos sao suportes genericos para controle DualSense de PS5, sem marca "
     "e sem codigo de modelo em nenhum dos dois. O campo brand da seed no ML "
     "e \"3D\", que e lixo e nao identifica. Nao da para certificar SAME. Candidate rank 18."),
    ("Suporte Gamer Para Controle PS5 DualSense 3D",
     "Suporte PS5 Controle DualSense-Suporte Mesa Game - Organizador Controle Playstation",
     "Mesmo caso: suportes genericos para DualSense sem identificador "
     "compartilhado. Candidate rank 20."),
]


def normalizar(t):
    t = unicodedata.normalize("NFD", t.lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", t).strip()


def main():
    origem, destino = sys.argv[1], sys.argv[2]
    with open(origem, encoding="utf-8") as fh:
        pares = json.load(fh)

    idx_same = {(normalizar(a), normalizar(b)): m for a, b, m in SAME}
    idx_amb = {(normalizar(a), normalizar(b)): m for a, b, m in AMBIGUOUS}

    # sanidade: todo SAME/AMBIGUOUS precisa existir no arquivo de pares
    chaves = {(normalizar(p["seedTitle"]), normalizar(p["candidateTitle"])) for p in pares}
    for a, b in list(idx_same) + list(idx_amb):
        if (a, b) not in chaves:
            raise SystemExit(f"ground truth orfao (nao existe no probe): {a[:50]} || {b[:50]}")

    contagem = {"SAME": 0, "DIFFERENT": 0, "AMBIGUOUS": 0}
    prefilter = 0
    for par in pares:
        chave = (normalizar(par["seedTitle"]), normalizar(par["candidateTitle"]))
        if chave in idx_same:
            par["label"] = "SAME"
            par["reason"] = idx_same[chave]
            par["origem"] = "LEITURA"
        elif chave in idx_amb:
            par["label"] = "AMBIGUOUS"
            par["reason"] = idx_amb[chave]
            par["origem"] = "LEITURA"
        else:
            par["label"] = "DIFFERENT"
            par["origem"] = "PREFILTRO_ACESSORIO" if ACESSORIO_RE.search(par["candidateTitle"]) else "LEITURA"
            if par["origem"] == "PREFILTRO_ACESSORIO":
                prefilter += 1
                par["reason"] = ("Candidato e acessorio/peca de reposicao (filtro "
                                 "mecanico ACESSORIO_RE). Papel divergente do "
                                 "produto principal: R1.")
            else:
                par["reason"] = ("Sem identificador compartilhado apos leitura: "
                                 "marca, modelo ou eixo declarado divergente "
                                 "nos dois lados. R3/R4.")
        contagem[par["label"]] += 1

    with open(destino, "w", encoding="utf-8") as fh:
        json.dump(pares, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

    print(f"BENCHMARK_ROWS={len(pares)}")
    print("LABELS=" + json.dumps(contagem, ensure_ascii=False))
    print(f"DIFFERENT_VIA_PREFILTRO_MECANICO={prefilter}")
    print(f"DIFFERENT_VIA_LEITURA={contagem['DIFFERENT'] - prefilter}")
    print(f"SAME_DECIDIDO_POR_LEITURA={contagem['SAME']}")
    print(f"GRUPOS_SAME_DISTINTOS={len({normalizar(a) for a, _, _ in SAME})}")


if __name__ == "__main__":
    main()
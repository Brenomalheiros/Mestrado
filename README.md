# PANORAMA AMBIENTAL DAS ÁREAS VERDES INTRAURBANAS NOS MUNICÍPIOS DA REGIÃO METROPOLITANA DE RIBEIRÃO PRETO ATRAVÉS DE INTELIGÊNCIA GEOESPACIAL

_Dissertação apresentada ao Programa de Pós-Graduação em Engenharia Urbana da Universidade Federal de São Carlos, como parte dos requisitos para obtenção do título de mestre em Engenharia Urbana_

Este repositório reúne os scripts utilizados na pesquisa de mestrado para análise da dinâmica de uso e cobertura da terra na Região Metropolitana de Ribeirão Preto (RMRP) entre os anos de 1985 e 2024, com base em imagens Landsat e técnicas de classificação supervisionada.

## 🌎 Contexto da Pesquisa

A escolha pela série Landsat se dá pela sua longa disponibilidade temporal, cobrindo quatro décadas. Embora sensores mais recentes tenham melhor resolução, a análise histórica ampla requer um acervo contínuo como o do Landsat. As imagens são organizadas em mosaicos anuais e normalizadas para garantir comparabilidade entre diferentes sensores (L5, L7, L8, L9).

A classificação foi feita com o algoritmo **Random Forest**, com quatro classes principais:
- Vegetação arbórea
- Vegetação herbácea
- Áreas impermeabilizadas
- Corpos hídricos

## 🛰️ Mosaicos e Indicadores

Cada mosaico anual inclui:

- Bandas espectrais: `blue`, `green`, `red`, `nir`, `swir1`, `swir2`
- Índices espectrais: `ndvi`, `mndwi`, `ndbi`, `bsi`
- Frações espectrais (SMA): `veg`, `sub`, `dark`

Todos os mosaicos passam por **normalização espectral (p5–p95)** para padronizar reflectância e reduzir ruídos radiométricos.

## 🏷️ Produção de Amostras

Amostras são geradas automaticamente com base no MapBiomas e Dynamic World, somando 30.000 pontos aleatórios. São aplicados filtros espectrais e remoção de outliers (p5–p95) para garantir qualidade do conjunto de treino.

## 🌳 Classificação Supervisionada

- Algoritmo: `Random Forest`
- Classes: `arbórea`, `herbácea`, `impermeável`, `água`
- Entradas: bandas, índices e frações espectrais
- Treinamento iterativo para otimizar acurácia e tempo computacional

## 🧩 Tratamento de Pixels Mistos

O estudo incorpora frações espectrais (SMA) diretamente na classificação para representar a composição interna dos pixels mistos — comuns em áreas urbanas com resolução de 30 m.

## 🧽 Filtros e Recuperação de Dados

Foram utilizados filtros de reconstrução com base em:
1. Informações espaciais (ex: interpolação, difusão)
2. Correlações espectrais entre bandas
3. Séries temporais para criar mosaicos sem nuvens
4. Métodos híbridos, combinando abordagens

## ✅ Validação

A validação considera:
- Amostragem estratificada por classe (baseada no MapBiomas)
- Comparação com dados de referência compatíveis em escala e tempo
- Cálculo de métricas de acurácia conforme Olofsson et al. (2014)

## 📜 Tabela de Scripts e Funções

| Nome do Script / Notebook        | Etapa do Pipeline                 | Descrição Resumida                                                                 |
|----------------------------------|-----------------------------------|-------------------------------------------------------------------------------------|
| `1001_selfSampling`              | Geração de Amostras               | Cria 30.000 pontos aleatórios com dados espectrais a partir do MapBiomas/DW.       |
| `Sample_reviewer.ipynb`          | Seleção Automática e Visualização | Processa e estrutura amostras com geometria para posterior classificação.          |
| `sample_label.py`                | Validação Visual das Amostras     | Interface para rotulagem manual com base em mosaicos Landsat (RGB, NDVI, MNDWI).   |
| `1002-ML_RMRP-multiModel`        | Classificação Supervisionada      | Treina/aplica Random Forest com mosaicos e amostras validadas.                     |
| `1003-ML_filtro_temporal`        | Pós-processamento Temporal        | Suaviza ruídos temporais aplicando filtro K3 à série classificada.                |



| Nome do Script / Notebook        | Etapa do Pipeline           | Descrição Resumida                                                                 |
|----------------------------------|-----------------------------|-------------------------------------------------------------------------------------|
| `1001_selfSampling`              | Geração de Amostras         | Cria 30.000 pontos aleatórios com dados espectrais a partir do MapBiomas/DW.       |
| `Sample_reviewer.ipynb`          | Seleção Automática e Visualização de Amostras  | Lê e converte CSV das amostras, permitindo a visualização e estruturação espacial das amostras para posterior classificação.|
| `1002-ML_RMRP-multiModel`        | Classificação Supervisionada| Treina/aplica Random Forest com mosaicos e amostras validadas.                     |
| `1003-ML_filtro_temporal`        | Pós-processamento Temporal  | Suaviza ruídos temporais aplicando filtro K3 à série classificada.                |



| Nome do Script                 | Etapa do Pipeline                  | Descrição Resumida                                                                 |
|-------------------------------|------------------------------------|-------------------------------------------------------------------------------------|
| `1001_selfSampling`           | Geração de Amostras                | Cria 30.000 pontos aleatórios balanceados com base em MapBiomas/Dynamic World.     |
| `1002-ML_RMRP-multiModel`     | Classificação Supervisionada       | Treina/aplica Random Forest com atributos Landsat (bandas, índices, SMA) por ano.  |
| `1003-ML_filtro_temporal`     | Pós-processamento Temporal         | Aplica filtro K3 para corrigir transições abruptas e suavizar a série de classes.  |

## 📁 Estrutura Recomendada

```
GEE/
├── 1001_selfSampling
├── 1002-ML_RMRP-multiModel
├── 1003-ML_filtro_temporal
├── utils/
│   └── funções auxiliares (índices, SMA, normalização etc.)
└── README.md
```

## 📦 Requisitos

Os scripts são desenvolvidos na plataforma **Google Earth Engine**, portanto:

- Requer conta ativa no GEE
- Scripts escritos em JavaScript (interface Code Editor)
- Algumas análises complementares podem ser feitas em Python (opcional)

## 👤 Autor

Breno Malheiros  
Programa de Pós-Graduação em Engenharia Urbana – UFSCar  
Orientação: Prof. Dr. Fabio Noel Stanganini

---

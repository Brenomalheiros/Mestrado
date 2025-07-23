import ee
import geemap.foliumap as geemap
import streamlit as st
import pandas as pd
import geopandas as gpd
from shapely.geometry import Point
import os
import time
import shutil

# Funções auxiliares
def timer_debug(label, start_time):
    print(f'[TIMER] {label} levou {time.time() - start_time:.2f}s')

def sanitize_dataframe(df):
    if 'id' in df.columns:
        df['id'] = pd.to_numeric(df['id'], errors='coerce')
        if df['id'].isnull().any():
            raise ValueError('Existem amostras sem ID definido!')
        df['id'] = df['id'].astype(int)
    for col in df.columns:
        if col.startswith('class_id_'):
            df[col] = pd.to_numeric(df[col], errors='coerce')
    return df

def backup_csv(original_path):
    backup_folder = os.path.join(os.path.dirname(original_path), 'backup')
    os.makedirs(backup_folder, exist_ok=True)
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    backup_filename = os.path.join(backup_folder, f"backup_{timestamp}.csv")
    shutil.copy2(original_path, backup_filename)
    print(f'[DEBUG] Backup criado: {backup_filename}')

    # Limpeza dos backups antigos (manter os 100 mais recentes com mais de 1h)
    backups = sorted([os.path.join(backup_folder, f) for f in os.listdir(backup_folder) if f.endswith('.csv')], key=os.path.getmtime, reverse=True)
    backups_to_check = backups[100:]
    now = time.time()
    for bkp in backups_to_check:
        if now - os.path.getmtime(bkp) > 3600:
            os.remove(bkp)
            print(f'[DEBUG] Backup antigo removido: {bkp}')

def create_square(point, distance_m=500):
    start = time.time()
    center = ee.Geometry.Point(point.x, point.y)
    rect = center.buffer(distance_m).bounds()
    timer_debug('Create square', start)
    return rect

def get_mosaic(year):
    start = time.time()
    mosaic = ee.Image(f'projects/brenomalheiros-ufscar/assets/mosaic_RMRP/mosaic_{year}-3')
    timer_debug(f'Load mosaic {year}', start)
    return mosaic

# Inicialização do Streamlit
if 'ee_initialized' not in st.session_state:
    start = time.time()
    try:
        ee.Initialize()
    except Exception:
        ee.Authenticate()
        ee.Initialize()
    st.session_state.ee_initialized = True
    timer_debug('ee.Initialize()', start)

st.set_page_config(layout="wide")

output_folder = 'streamlit_samples_data'
os.makedirs(output_folder, exist_ok=True)

csv_filename = os.path.join(output_folder, 'amostras_validadas.csv')
gpkg_points_filename = os.path.join(output_folder, 'pontos_amostras.gpkg')
anos = [1985, 1990, 2000, 2010, 2020, 2024]

# Carrega pontos
if os.path.exists(gpkg_points_filename):
    gdf_points = gpd.read_file(gpkg_points_filename)
else:
    amostras = ee.FeatureCollection('projects/brenomalheiros-ufscar/assets/raw_val_samples-600-seed_10')
    features = amostras.getInfo()['features']
    data = [{'longitude': f['geometry']['coordinates'][0], 'latitude': f['geometry']['coordinates'][1]} for f in features]
    gdf_points = gpd.GeoDataFrame(data, geometry=gpd.points_from_xy([d['longitude'] for d in data], [d['latitude'] for d in data]), crs="EPSG:4326")
    gdf_points.to_file(gpkg_points_filename, driver="GPKG")

# Inicializa CSV
if not os.path.exists(csv_filename):
    df_init = pd.DataFrame({'id': range(len(gdf_points))})
    for ano in anos:
        df_init[f'class_id_{ano}'] = pd.NA
        df_init[f'class_nm_{ano}'] = pd.NA
        df_init[f'obs_{ano}'] = pd.NA
    df_init['longitude'] = gdf_points.geometry.x
    df_init['latitude'] = gdf_points.geometry.y
    df_init['geometry'] = gdf_points.geometry
    df_init = sanitize_dataframe(df_init)
    df_init.to_csv(csv_filename, index=False)

# Carrega CSV
df_samples = pd.read_csv(csv_filename, dtype=str)
df_samples = sanitize_dataframe(df_samples)
st.session_state.samples = df_samples.to_dict('records')

# Interface Streamlit
st.markdown("<h4>🌎 Rotulagem de Amostras Landsat</h4>", unsafe_allow_html=True)
tabs = st.tabs(["🔖 Classificar Amostras", "📄 Visualizar CSV"])

classe_options = {
    1: "🌳 Arbórea",
    2: "🏙️ Impermeável",
    3: "🌾 Herbácea",
    4: "💧 Água",
    5: "🚜 Agricultura",
    6: "❓ Outros"
}

total_pontos = len(gdf_points)
if 'current_index' not in st.session_state:
    st.session_state.current_index = 0
if 'current_year_index' not in st.session_state:
    st.session_state.current_year_index = 0

# Aba 1: Classificar Amostras
with tabs[0]:
    with st.sidebar:
        index = st.number_input('📍 Ponto', min_value=0, max_value=total_pontos-1, value=int(st.session_state.current_index), step=1)
        st.session_state.current_index = index

        year = st.selectbox('📅 Ano', anos, index=st.session_state.current_year_index)
        st.session_state.current_year_index = anos.index(year)

        completed_years = []
        current_id = int(index)
        for ano in anos:
            for s in st.session_state.samples:
                if int(s['id']) == current_id and pd.notna(s.get(f'class_id_{ano}')):
                    completed_years.append(ano)

        year_status = "✅" if year in completed_years else "⬜"
        st.markdown(f"<b>📅 Ano atual:</b> {year} {year_status}", unsafe_allow_html=True)

        class_selection = st.selectbox("🏷️ Classe:", options=list(classe_options.keys()), format_func=lambda x: f"{x} - {classe_options[x]}")
        obs_text = st.text_input("📜 Observações", key="obs_text")
        st.markdown("**Sugestões:** `duvida`, `borda`, `sem imagem`")

        col_botoes = st.columns(2)
        with col_botoes[0]:
            if st.button('🔙 Voltar'):
                st.session_state.current_index = max(st.session_state.current_index - 1, 0)
                st.session_state.current_year_index = 0
                st.rerun()
        with col_botoes[1]:
            save_clicked = st.button('💾 Salvar e Avançar')

        st.markdown("<b>🗓️ Progresso deste ponto:</b>", unsafe_allow_html=True)
        st.markdown(" ".join([f"{a} ✅" if a in completed_years else f"{a} ⬜" for a in anos]))

    if save_clicked:
        start = time.time()
        row = gdf_points.iloc[index]

        sample = {
            'id': int(index),
            f'class_id_{year}': int(class_selection),
            f'class_nm_{year}': classe_options[class_selection][2:].lower(),
            f'obs_{year}': obs_text,
            'longitude': row.geometry.x,
            'latitude': row.geometry.y,
            'geometry': row.geometry
        }

        updated = False
        for s in st.session_state.samples:
            if int(s['id']) == int(index):
                s.update(sample)
                updated = True
                break
        if not updated:
            st.session_state.samples.append(sample)

        backup_csv(csv_filename)

        df = pd.DataFrame(st.session_state.samples)
        df = sanitize_dataframe(df)
        gdf = gpd.GeoDataFrame(df, geometry=gpd.points_from_xy(df.longitude, df.latitude), crs="EPSG:4326")
        gdf.to_csv(csv_filename, index=False)
        timer_debug('Salvar CSV', start)

        # Avança para o próximo ano ou ponto
        if st.session_state.current_year_index < len(anos) - 1:
            st.session_state.current_year_index += 1
        else:
            filled_all = all(
                not pd.isna(s.get(f'class_id_{a}'))
                for s in st.session_state.samples if int(s['id']) == index
                for a in anos
            )
            if filled_all:
                st.session_state.current_index = min(index + 1, total_pontos - 1)
            st.session_state.current_year_index = 0

        st.rerun()

    row = gdf_points.iloc[st.session_state.current_index]
    point = ee.Feature(ee.Geometry.Point([row.geometry.x, row.geometry.y]))
    mosaic = get_mosaic(year)
    geom_1km = create_square(row.geometry, 500)
    geom_5km = create_square(row.geometry, 2500)
    clip_1km = mosaic.clip(geom_1km)

    rgb_vis = {'bands': ['red', 'green', 'blue'], 'min': 0, 'max': 1.5}
    ndvi_vis = {
        'bands': ['ndvi'],
        'min': -0.07,
        'max': 0.7,
        'palette': [
            '#654321',  # solo exposto / negativo
            '#ffbb22',  # vegetação rala
            '#ffff4c',  # pasto
            '#aaff55',  # vegetação média
            '#55aa00',  # vegetação densa
            '#007700'   # vegetação muito densa
        ]
    }

    mndwi_vis = {
        'bands': ['mndwi'],
        'min': -0.5,
        'max': 0.5,
        'palette': [
            '#ffffff',  # áreas secas ou urbanas (negativo)
            '#c0c0c0',  # solo úmido / transição
            '#66ccff',  # água rasa
            '#0000ff'   # água profunda
        ]
    }

    ponto_vis = {'color': 'pink'}

    col1, col2, col3 = st.columns(3)

    with col1:
        st.markdown("<h5>🖼️ RGB (1km)</h5>", unsafe_allow_html=True)
        Map1 = geemap.Map()
        Map1.centerObject(point, 15)
        Map1.addLayer(clip_1km, rgb_vis, 'RGB 1km')
        Map1.addLayer(point, ponto_vis, 'Ponto')
        Map1.to_streamlit(height=250)

    with col2:
        st.markdown("<h5>🌿 NDVI (1km)</h5>", unsafe_allow_html=True)
        Map2 = geemap.Map()
        Map2.centerObject(point, 15)
        Map2.addLayer(clip_1km, ndvi_vis, 'NDVI 1km')
        Map2.addLayer(point, ponto_vis, 'Ponto')
        Map2.to_streamlit(height=250)

    with col3:
        st.markdown("<h5>💧 MNDWI (1km)</h5>", unsafe_allow_html=True)
        Map3 = geemap.Map()
        Map3.centerObject(point, 15)
        Map3.addLayer(clip_1km, mndwi_vis, 'MNDWI 1km')
        Map3.addLayer(point, ponto_vis, 'Ponto')
        Map3.to_streamlit(height=250)

    st.markdown("<h5>🛰️ Satélite Atual (5km)</h5>", unsafe_allow_html=True)
    Map4 = geemap.Map()
    Map4.centerObject(point, 13)
    Map4.add_basemap('SATELLITE')
    Map4.addLayer(point, ponto_vis, 'Ponto')
    Map4.to_streamlit(height=400)

# Aba 2: Visualizar CSV
with tabs[1]:
    st.markdown("<h5>📄 Dados Salvos até o momento</h5>", unsafe_allow_html=True)
    df_display = pd.read_csv(csv_filename)
    st.dataframe(df_display, use_container_width=True)

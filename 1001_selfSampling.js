// ==============================================
// SCRIPT: 1001_selfSampling
// ETAPA: Geração de Amostras
// OBJETIVO: Gerar amostras balanceadas para treinamento do classificador Random Forest,
//           com base nos mapas de referência do MapBiomas e Dynamic World
// ==============================================

// 1. Define geometria e pontos fixos
var geometry = ee.FeatureCollection("projects/brenomalheiros-ufscar/assets/LimiteMunicipal_2021")
  .filter(ee.Filter.eq('RM','RM de Ribeirão Preto'))
  .geometry()
  .dissolve()

Map.centerObject(geometry,10)
Map.addLayer(geometry,{},'RMRP')

var seed = 20
var nSamples = 30000
var version = 7


var pts = ee.FeatureCollection.randomPoints(geometry, nSamples*0.85, seed).set({'origem':'rmrp'})
Map.addLayer(pts, {}, 'Pontos Base')

// 2. Define anos e bandas
var years = [//1985,1986,1987,1988,1989,1990,1991,1992,1993,1994,1995,1996,1997,1998,1999,
             //2000,2001,2002,2003,2004,2005,2006,2007,2008,2009,2010,2011,2012,2013,2014,
             2015,2016,2017,2018,2019,2020,2021,2022,
             2023]  // adicione todos que quiser

var cloud_cover_value = 10

//var waterLines = ee.FeatureCollection('users/spatialeanalytics/OSM_water_Brazil/water_lines_intersect_brazil')
var waterPolygons = ee.FeatureCollection('users/spatialeanalytics/OSM_water_Brazil/water_polygons_intersect_brazil')
                      .filterBounds(geometry)
                      //.map(function(ft){return ft.simplify(10)})

// Map.addLayer(waterLines,{},'water_lines')
// Map.addLayer(waterPolygons,{},'ater_polygons')

var urban_ibge = ee.FeatureCollection("projects/brenomalheiros-ufscar/assets/AreasUrbanizadas2019_Brasil")
                          .filter(ee.Filter.neq('Densidade','Loteamento vazio'))
                          .filterBounds(geometry)
                          //.map(function(ft){return ft.simplify(10)})
                          //.dissolve()
                          
Map.addLayer(urban_ibge,{},'urban_ibge')

var pts_wt = ee.FeatureCollection.randomPoints(waterPolygons, nSamples*0.05, seed).set({'origem':'osm_water'})
Map.addLayer(pts_wt,{},'pts_wt')
var pts_ua = ee.FeatureCollection.randomPoints(urban_ibge, nSamples*0.1, seed).set({'origem':'ibge_ua2019'})
Map.addLayer(pts_ua,{},'pts_ua')

pts = pts.merge(pts_wt).merge(pts_ua)

// 3. Funções espectrais (como antes)
var maskcloud = function(image) {
  var qa = image.select('QA_PIXEL')
  return image.updateMask(qa.bitwiseAnd(1 << 3).eq(0))
}
var applySaturationMask = function(image) {
  var sat = image.select('QA_RADSAT')
  // Remover qualquer pixel onde qualquer banda (1–7) esteja saturada (bits 0–6)
  var mask = sat.bitwiseAnd(127).eq(0)  // 127 = 01111111
  return image.updateMask(mask)
}

var getNDVI = function(image) {
  var ndvi = image.expression(
    '(nir - red) / (nir + red)',
    {
      'nir': image.select('nir'),
      'red': image.select('red')
    }
  ).rename('ndvi');
  return image.addBands(ndvi);
};

var getMNDWI = function(image) {
  var mndwi = image.expression(
    '(green - swir1) / (green + swir1)',
    {
      'green': image.select('green'),
      'swir1': image.select('swir1')
    }
  ).rename('mndwi');
  return image.addBands(mndwi);
};

var getNDBI = function(image) {
  var ndbi = image.expression(
    '(swir1 - nir) / (swir1 + nir)',
    {
      'swir1': image.select('swir1'),
      'nir': image.select('nir')
    }
  ).rename('ndbi');
  return image.addBands(ndbi);
};

var getBSI = function(image) {
  var bsi = image.expression(
    '((swir1 + red)-(nir + blue))/((swir1 + red)+(nir + blue))',
    {'swir1': image.select('swir1'), 'red': image.select('red'), 'nir': image.select('nir'), 'blue': image.select('blue')}
  ).rename('bsi')
  return image.addBands(bsi)
}

var getSMA = function(image){
  var img = image.select('blue','green','red','nir','swir1','swir2')
  var substrate = [0.211200, 0.317455, 0.426777, 0.525177, 0.623311, 0.570544]
  var veg       = [0.093026, 0.086723, 0.049961, 0.611243, 0.219628, 0.079601]
  var dark      = [0.081085, 0.044215, 0.025971, 0.017209, 0.004792, 0.002684]
  return image.addBands(img.unmix([substrate, veg, dark], true, true).rename(['sub', 'veg', 'dark']))
}


// Normalização com base em p5–p95 usando unitScale
var normalizeByPercentile = function(image) {
  var bands = ['blue','green','red','nir','swir1','swir2']

  var percentiles = image.select(bands).reduceRegion({
    reducer: ee.Reducer.percentile([5, 95]),
    geometry: geometry,
    scale: 30,
    bestEffort: true,
  })

  // Cria bandas normalizadas usando unitScale(p5, p95)
  var normalized = ee.ImageCollection(bands.map(function(b) {
    var min = ee.Number(percentiles.get(b + '_p5'))
    var max = ee.Number(percentiles.get(b + '_p95'))
    return image.select(b).unitScale(min, max).rename(b)
  })).toBands().rename(bands.map(function(b) { return b }))

  return normalized
}



// 4. Loop por ano: extrair dados e juntar
var enriched_pts = pts

var mb = ee.Image('projects/mapbiomas-public/assets/brazil/lulc/collection9/mapbiomas_collection90_integration_v1')
var dw = ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1').filterBounds(geometry)

years.forEach(function(year){
  var l5 = ee.ImageCollection('LANDSAT/LT05/C02/T1_TOA')
    .filterBounds(geometry)
    .filterDate(year + '-01-01', year + '-12-31')
    .filter(ee.Filter.lt('CLOUD_COVER', cloud_cover_value))
    .filter(ee.Filter.neq('CLOUD_COVER', -1))
    .select(['B1','B2','B3','B4','B5','B7','QA_PIXEL','QA_RADSAT'],['blue','green','red','nir','swir1','swir2','QA_PIXEL','QA_RADSAT'])
  

  var l7 = ee.ImageCollection('LANDSAT/LE07/C02/T1_TOA')
    .filterBounds(geometry)
    .filterDate(year + '-01-01', year + '-12-31')
    .filter(ee.Filter.lt('CLOUD_COVER', cloud_cover_value))
    .filter(ee.Filter.neq('CLOUD_COVER', -1))
    .select(['B1','B2','B3','B4','B5','B7','QA_PIXEL','QA_RADSAT'],['blue','green','red','nir','swir1','swir2','QA_PIXEL','QA_RADSAT'])
    


  var l8 = ee.ImageCollection('LANDSAT/LC08/C02/T2_TOA')
    .filterBounds(geometry)
    .filterDate(year + '-01-01', year + '-12-31')
    .filter(ee.Filter.lt('CLOUD_COVER', cloud_cover_value))
    .filter(ee.Filter.neq('CLOUD_COVER', -1))
    .select(['B2','B3','B4','B5','B6','B7','QA_PIXEL','QA_RADSAT'],['blue','green','red','nir','swir1','swir2','QA_PIXEL','QA_RADSAT'])
    
    
    
   var l9 = ee.ImageCollection("LANDSAT/LC09/C02/T1_TOA")
    .filterBounds(geometry)
    .filterDate(year + '-01-01', year + '-12-31')
    .filter(ee.Filter.lt('CLOUD_COVER', cloud_cover_value))
    .filter(ee.Filter.neq('CLOUD_COVER', -1))
    .select(['B2','B3','B4','B5','B6','B7','QA_PIXEL','QA_RADSAT'],['blue','green','red','nir','swir1','swir2','QA_PIXEL','QA_RADSAT'])
    
    
  
  var landsat = l9.merge(l8).merge(l7).merge(l5).sort('CLOUD_COVER',true).limit(30)
  print(year,landsat)
 
  landsat = landsat
    .map(maskcloud)
    .map(applySaturationMask)
    .map(getNDVI)
    .map(getMNDWI)
    .map(getNDBI)
    .map(getBSI)
    .map(getSMA)
    .map(function(img) {
      // Normaliza apenas bandas espectrais, mantendo índices intactos
      var normalized = normalizeByPercentile(img.select(['blue','green','red','nir','swir1','swir2']))
      return img.select(['ndvi','mndwi','ndbi','bsi','sub','veg','dark'])
                .addBands(normalized)
    })



  var mosaic = landsat.median().clip(geometry)
  var stdImage = landsat.reduce(ee.Reducer.stdDev())

  // Renomeia as bandas de desvio padrão para manter clareza
  var stdBands = stdImage.bandNames().map(function(b){
    return ee.String(b).replace('_stdDev', '_std')
  })
  stdImage = stdImage.rename(stdBands)
  print(stdImage)
  
  Map.addLayer(mosaic,{},'mosaic_' + year, false)
  Map.addLayer(stdImage,{},'std_' + year, false)
  
  
  mosaic = mosaic.addBands(stdImage)
  
  print('mosaic_final', mosaic)
  
  var mapbiomas = mb.select('classification_' + year).rename('mb_' + year)

  var dw_median = dw.filterDate(year + '-01-01', year + '-12-31')
                  .select('label')
                  .reduce(ee.Reducer.median())
                  .rename('dw_' + year)
  
  
  // Renomeia bandas com sufixo do ano
  var mosaicBands = mosaic.bandNames()
  print('mosaicBands',mosaicBands)
  
  var renamedBands = mosaicBands.map(function(b) {
    return ee.String(b).cat('_').cat(ee.Number(year).format())
  })
  print('renamedBands',renamedBands)  
  
  var image = mosaic
    .select(mosaicBands,renamedBands)
    .addBands(mapbiomas)
    .addBands(dw_median)
    
  print('image',image.bandNames())
  
  var sampled = image.reduceRegions({
    collection: enriched_pts,
    reducer: ee.Reducer.first(),
    scale: 30
  })
  //print('sampled',sampled.propertyNames())
  
  // Une atributos no ponto base
  enriched_pts = sampled
})

// 5. Exporta asset final com todas as colunas multitemporais
Export.table.toAsset({
  collection: enriched_pts,
  description: 'ASSET-Samples_2015-2023_v' + version,
  assetId: 'projects/brenomalheiros-ufscar/assets/samples_v2/Samples_2015-2023_v' + version
})

//MUITAS COLUNAS - NÃO É POSSÍVEL EXPORTAR COMO SHP
// Export.table.toDrive({
//   collection: enriched_pts,
//   folder:'GEE-Samples_RMRP-v'+ version,
//   description: 'Samples_2015-2023_v' + version,
//   fileFormat: 'SHP'
// })

Export.table.toDrive({
  collection: enriched_pts,
  folder:'GEE-Samples_RMRP-v'+ version,
  description: 'Samples_2015-2023_v' + version,
  fileFormat: 'CSV'
})

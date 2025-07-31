// ==============================================
// SCRIPT: 1002-ML_RMRP-multiModel
// ETAPA: Classificação Supervisionada
// OBJETIVO: Treinar e aplicar modelos Random Forest anuais com mosaicos Landsat e amostras
// ==============================================

/**** Start of imports. If edited, may not auto-convert in the playground. ****/
var validation_2022 = ee.FeatureCollection("projects/brenomalheiros-ufscar/assets/validation-1700_v1");
/***** End of imports. If edited, may not auto-convert in the playground. *****/
// 1. Define geometria e pontos fixos
var geometry = ee.FeatureCollection("projects/brenomalheiros-ufscar/assets/LimiteMunicipal_2021")
  .filter(ee.Filter.eq('RM','RM de Ribeirão Preto'))
  .geometry()
  .dissolve()

//Map.centerObject(geometry,10)
Map.addLayer(geometry,{},'RMRP')

var desc = 'Classificação com amostras automatizadas: Samples_2016-2023-v7-filtered, mosaico normalizado, correção de geometria do mosaico e multiprobabilidade construida com 5 modelos treinados separadamente, sem uso da classe de agricultura'
var output_version = 8
var step = 'classification_raw'
var seed = 20
var year_list = //[1985,2000,2024]
[1985,1986,1987,1988,1989,1990,1991,1992,1993,1994,1995,1996,1997,1998,1999,
                2000,2001,2002,2003,2004,2005,2006,2007,2008,2009,2010,2011,2012,2013,2014,
                2015,2016,2017,2018,2019,2020,2021,2022,2023,2024]



var cloud_cover_value = 10
  
//Amostras
var samples = ee.FeatureCollection('projects/brenomalheiros-ufscar/assets/samples_v2/Samples_2016-2023-v7-filtered')

var classProperty = 'cc'

var inputBands = [
  'blue', 'green', 'red', 'nir', 'swir1', 'swir2',
  'ndvi', 'mndwi', 'ndbi', 'bsi', 'sub', 'veg', 'dark',
  'blue_std', 'green_std', 'red_std', 'nir_std', 'swir1_std', 'swir2_std',
  'ndvi_std', 'mndwi_std', 'ndbi_std', 'bsi_std', 'sub_std', 'veg_std', 'dark_std'
]


////////////////////////////
// Treinamento de modelos //
////////////////////////////
//1-arboreo, 2-imperm, 3-herbacea, 4-agua, 5-agricultura, 6-outros
var training = samples.remap([1,2,3,4,5,6],[1,2,3,4,3,6],'cc')
  .filter(ee.Filter.eq('v_y', 1))        // somente amostras válidas
  .filter(ee.Filter.lt('cc', 6));        // descarta classe 6 ("outras")


// Mapear a classe 'cc' para binária para cada classe-alvo
var training_arb   = training.remap([1,2,3,4], [1,0,0,0], 'cc')
var training_imper = training.remap([1,2,3,4], [0,1,0,0], 'cc')
var training_herb  = training.remap([1,2,3,4], [0,0,1,0], 'cc')
var training_water = training.remap([1,2,3,4], [0,0,0,1], 'cc')
//var training_agri  = training.remap([1,2,3,4,5], [0,0,0,0,1], 'cc')

    
function trainBinaryRF(trainingSet) {
  return ee.Classifier.smileRandomForest({
    numberOfTrees: 200,
    seed: seed
  })
  .setOutputMode('PROBABILITY')
  .train({
    features: trainingSet,
    classProperty: classProperty,
    inputProperties: inputBands
  });
}

var clf_arb   = trainBinaryRF(training_arb);
var clf_imper = trainBinaryRF(training_imper);
var clf_herb  = trainBinaryRF(training_herb);
var clf_water = trainBinaryRF(training_water);
//var clf_agri  = trainBinaryRF(training_agri);

    

                        
/// 3. Funções espectrais (como antes)
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

var mosaic_dataset = ee.ImageCollection([])


var main_function = year_list.map(function(year){

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
  //print(stdImage)
  
  //Map.addLayer(mosaic,{},'mosaic_' + year, false)
  //Map.addLayer(stdImage,{},'std_' + year, false)
  
  mosaic = mosaic.addBands(stdImage)
  //Map.addLayer(mosaic,{min:0,max:1.5, bands:['red','green','blue']},'mosaic-' + year, false)
  
  var image = mosaic
  //print('image',image.bandNames())

  var prob_arb   = mosaic.classify(clf_arb)   .rename('prob_arb'    ).multiply(100).toInt8()
  var prob_imper = mosaic.classify(clf_imper) .rename('prob_imper'  ).multiply(100).toInt8()
  var prob_herb  = mosaic.classify(clf_herb)  .rename('prob_herb'   ).multiply(100).toInt8()
  var prob_water = mosaic.classify(clf_water) .rename('prob_water'  ).multiply(100).toInt8()
  //var prob_agri  = mosaic.classify(clf_agri)  .rename('prob_agri'   ).multiply(100).toInt8()
  
  var classification_prob = prob_arb
    .addBands(prob_imper)
    .addBands(prob_herb)
    .addBands(prob_water)
    //.addBands(prob_agri);


  var class_idx = classification_prob
    .toArray()
    .arrayArgmax()
    .arrayFlatten([['class_idx']]);

  var final_class = class_idx.add(1).rename('classification');

  
  // Adiciona 1 para que os valores fiquem de 1 a 5
  var final_class = class_idx.add(1).rename('classification').addBands(classification_prob)
  print(final_class)
  
  //1-arboreo, 2-imperm, 3-herbacea, 4-agua, 5-agricultura, 6-outros
  //Map.addLayer(classification,{min:1,max:6,palette:['lime','red','yellow','blue','purple','gray']},'classification_'+year,false)
  Map.addLayer(final_class,{min:1,max:5,bands:['classification'],palette:['lime','red','yellow','blue','purple']},'classification_' + year,false)
  Map.addLayer(classification_prob, {min: 0, max: 1}, 'probabilidades_' + year, false);
  
  
  
 /* 
  // ==== FEATURE IMPORTANCE ====
  print('Feature Importance:', classifier.explain())

  var variable_importance = ee.Feature(null, ee.Dictionary(classifier.explain()).get('importance'));
  
  var chart1 =
  ui.Chart.feature.byProperty(variable_importance)
  .setChartType('ColumnChart')
  .setOptions({ 
  title: 'RF Variable Importance - Method 1',
  legend: {position: 'none'},
  hAxis: {title: 'Bands'},
  vAxis: {minValue:0, title: 'Importance'},
  });
  
  print(chart1, 'Relative Importance');
  
  
  //==== SPATIAL MASK ====
  var irs_threshold = 500
  // add the IRS index to the spatial filter
  var irs = ee.ImageCollection('users/efjustiniano/IRS2022/IRS2022_v5_30').sum()
  var irsUrb = irs.gte(irs_threshold)

  var classification_filtred = classification.where(irsUrb.eq(0),0).selfMask()
 // Map.addLayer(classification_filtred,{min:0,max:4,palette:['magenta','green','red','yellow','blue']},'masked_'+year,false)
*/
  
  var asset_name = 'class_'+year + '-' + output_version
  
  Export.image.toAsset({
    image:final_class.set({'year':year,'step':step,'output_ver':output_version,'description':desc}), 
    description:asset_name, 
    assetId:'projects/brenomalheiros-ufscar/assets/classification_RMRP/' + asset_name,
    region:geometry, 
    scale:30,
    })
    
  /*
  // Classify the test FeatureCollection.
  var test_classification = classification.sampleRegions(validation_2022,null,30);
  print('testando',test_classification.first())
  // Print the confusion matrix.
  var e_matrix = test_classification.errorMatrix('val_'+year,'classification_'+year);
  print('e_matrix_' + year,e_matrix)
  
  print('global_' + year, e_matrix.accuracy())
  print('consumidor_' + year, e_matrix.consumersAccuracy())
  print('produtor_' + year, e_matrix.producersAccuracy())
  */
  
  return null

  
}) 

main_function




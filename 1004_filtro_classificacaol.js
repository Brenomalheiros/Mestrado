// ==============================================
// SCRIPT: 1003-ML_filtro_temporal
// ETAPA: Pós-processamento Temporal
// OBJETIVO: Aplicar filtros K3 para suavizar ruídos na série temporal classificada
// ==============================================

// ====================
// CONFIGURAÇÃO
// ====================
var input_version = 8
var output_version = 10

var desc = 'Filtro espacial, com foco em remover ruído de água, e filtro de pixel solitário para todas as classes e patches para áreas impermeaveis; uso do IRS para reduzir comissão da classe impermeavel'

var step = 'spatial and temporal filter'
var years = ee.List.sequence(1985, 2024).getInfo();
var anosCentrais = years.filter(function(y){ return y > 1985 && y < 2024 });
print(anosCentrais)
var palette = ['gray','#006400', '#FF0000', '#FFFF00', '#0000FF', '#800080'];
var cloud_cover_value = 10;



// ====================
// BASE ORIGINAL
// ====================
var raw_col = ee.ImageCollection('projects/brenomalheiros-ufscar/assets/classification_RMRP')
  .filter(ee.Filter.eq('output_ver', input_version))
  .filter(ee.Filter.eq('step', 'classification_raw'))
  
var geometry = raw_col.geometry().bounds();

var irs_threshold = 500

// add the IRS index to the spatial filter
var irs = ee.ImageCollection('users/efjustiniano/IRS2022/IRS2022_v5_30').sum()
var irsUrb = irs.gte(irs_threshold)

// ====================
// CÁLCULO DA SEGUNDA CLASSE (com WHERE)
// ====================
var addSecondClassWhere = function(img) {
  // Probabilidades individuais
  var prob_arb   = img.select('prob_arb');
  var prob_imper = img.select('prob_imper');
  var prob_herb  = img.select('prob_herb');
  var prob_water = img.select('prob_water');
  //var prob_agri  = img.select('prob_agri');

  // Classe predominante (1 a 5)
  var main_class = img.select('classification');

  // Zera a classe principal: define -999 para ignorar
  prob_arb   = prob_arb.where(main_class.eq(1), -999);
  prob_imper = prob_imper.where(main_class.eq(2), -999);
  prob_herb  = prob_herb.where(main_class.eq(3), -999);
  prob_water = prob_water.where(main_class.eq(4), -999);
  //prob_agri  = prob_agri.where(main_class.eq(5), -999);

  // Inicializa com 1 (arb) e substitui com where()
  var second_class = ee.Image.constant(1)
    .where(prob_imper.gt(prob_arb)
            .and(prob_imper.gte(prob_herb))
            .and(prob_imper.gte(prob_water))
            //.and(prob_imper.gte(prob_agri))
            , 2)
    .where(prob_herb.gt(prob_arb)
            .and(prob_herb.gte(prob_imper))
            .and(prob_herb.gte(prob_water))
            //.and(prob_herb.gte(prob_agri))
            , 3)
    .where(prob_water.gt(prob_arb)
            .and(prob_water.gte(prob_imper))
            .and(prob_water.gte(prob_herb))
            //.and(prob_water.gte(prob_agri))
            , 4)
    // .where(prob_agri.gt(prob_arb)
    //         .and(prob_agri.gte(prob_imper))
    //         .and(prob_agri.gte(prob_herb))
    //         //.and(prob_agri.gte(prob_water))
    //         , 5)
    .rename('second_class');

  return img.addBands(second_class);
};

raw_col = raw_col.map(addSecondClassWhere)

// ====================
// 1. MÁSCARA NDWI
// ====================
var getMNDWI = function(image) {
  return image.expression(
    '(green - swir1) / (green + swir1)',
    {'green': image.select('green'), 'swir1': image.select('swir1')}
  ).rename('mndwi');
};

var l8 = ee.ImageCollection('LANDSAT/LC08/C02/T1_TOA')
  .filterBounds(geometry)
  .filterDate('2020-01-01', '2023-12-31')
  .filter(ee.Filter.lt('CLOUD_COVER', cloud_cover_value))
  .select(['B2','B3','B4','B5','B6','B7','QA_PIXEL'], ['blue','green','red','nir','swir1','swir2','QA_PIXEL']);

var ndwiMascara = l8.map(getMNDWI).median().gte(0);


// ====================
// 2. FILTRO ESPACIAL PERSONALIZADO
// ====================
function remove_patches(img,class_in,class_out,nPix) {
  //Map.addLayer(img,  {min:0, max:5, palette: palette}, 'Original',false);
  var agri = img.eq(class_in)
  
  // Remove buracos internos pequenos
  
  var grupoPequeno = agri.selfMask()
                         .connectedPixelCount()
                         .reproject({crs:'EPSG:4326', scale:30})
                         .lt(nPix)
                        
  //Map.addLayer(grupoPequeno,{min:0,max:1,palette: ['white','black']},'grupoPequeno', false);
                          
  img = img.where(grupoPequeno.eq(1), class_out).reproject({crs:'EPSG:4326', scale:30});
  //Map.addLayer(img,  {min:0, max:5, palette: palette}, 'Corrigido (classe in -> out)',false);

  return img
}

function fs_neighborhood(img) {
  var kernel = ee.Kernel.square({radius: 1});

  // Classe 4 (água)
  var agua = img.eq(4);
  var vizinhosAgua = agua.neighborhoodToBands(kernel).reduce(ee.Reducer.sum());
  var manterAgua = agua.and(vizinhosAgua.gte(4));
  img = img.where(agua.and(manterAgua.not()), img.focal_mode());

  // Classe 2 (impermeabilizado)
  var imp = img.eq(2);
  var vizinhosImp = imp.neighborhoodToBands(kernel).reduce(ee.Reducer.sum());
  var manterImp = imp.and(vizinhosImp.gte(4));
  img = img.where(imp.and(manterImp.not()), img.focal_mode());

  // Classe 5 (agricultura): substitui grupos pequenos
  img = remove_patches(img,2,3,50)
  
  var filter = img.where(irsUrb.eq(0).and(img.eq(2)),3).selfMask()
  
  return filter.rename('classification');
}


// ====================
// 3. APLICA CORREÇÕES NDWI + ESPACIAL
// ====================
function aplicarCorrecao(img) {
  
  var corrigido = img.select('classification')
                     .where(img.select('classification').eq(4)
                     .and(ndwiMascara.not()),img.select('second_class') ); // NDWI
  
  return fs_neighborhood(corrigido)
}

var collectionCorrigida = raw_col.map(aplicarCorrecao);


// ====================
// 4. DICIONÁRIO DOS CORRIGIDOS
// ====================
var dictCorrigido = ee.Dictionary(
  collectionCorrigida.toList(collectionCorrigida.size()).iterate(function(img, acc) {
    img = ee.Image(img);
    var ano = img.getNumber('year').int()
    return ee.Dictionary(acc).set(ano, img);
  }, ee.Dictionary({}))
);


// ====================
// 5. FILTRO TEMPORAL K3 – ANOS CENTRAIS
// ====================
print('dictCorrigido',dictCorrigido)
var imagensK3Centrais = anosCentrais.reverse().map(function(ano) {
  var anoNum = ee.Number(ano);
  var prev = ee.Image(dictCorrigido.get(anoNum.subtract(1)));
  var curr = ee.Image(dictCorrigido.get(anoNum));
  var next = ee.Image(dictCorrigido.get(anoNum.add(1)));

  return ee.ImageCollection([prev, curr, next])
    .reduce(ee.Reducer.mode())
    .rename('classification')
    .set('year', anoNum);
});
print('colecaoK3Centrais',colecaoK3Centrais)
var colecaoK3Centrais = ee.ImageCollection.fromImages(imagensK3Centrais).sort('year');


// ====================
// 6. DICIONÁRIO DOS ANOS CENTRAIS CORRIGIDOS
// ====================
var dictK3 = ee.Dictionary(
  colecaoK3Centrais.toList(colecaoK3Centrais.size()).iterate(function(img, acc) {
    img = ee.Image(img);
    var ano = img.getNumber('year').int()
    return ee.Dictionary(acc).set(ano, img);
  }, dictCorrigido)  // mantém os extremos ainda sem K3
);


// ====================
// 7. FILTRO TEMPORAL K3 – EXTREMOS
// ====================
var extremos = [1985, 2024];

var imagensK3Extremos = extremos.map(function(ano) {
  var anoNum = ee.Number(ano);
  var anosViz = ee.List(
    ano === 1985 ? [1985, 1986, 1987] : [2022, 2023, 2024]
  );

  var imgs = anosViz.map(function(a) {
    return ee.Image(dictK3.get(ee.Number(a)));
  });

  return ee.ImageCollection(imgs)
    .reduce(ee.Reducer.mode())
    .rename('classification')
    .set('year', anoNum);
});

var colecaoK3Extremos = ee.ImageCollection.fromImages(imagensK3Extremos);


// ====================
// 8. UNIÃO FINAL
// ====================
var colecaoFinalK3 = colecaoK3Centrais.merge(colecaoK3Extremos).sort('year');


// ====================
// 9. VISUALIZAÇÃO
// ====================
years.forEach(function(year){
  var raw = raw_col.filter(ee.Filter.eq('year', year)).first();
  var corrigida = collectionCorrigida.filter(ee.Filter.eq('year', year)).first();
  var k3 = colecaoFinalK3.filter(ee.Filter.eq('year', year)).first();
  
  print(year,raw.bandNames(),corrigida.bandNames(),k3.bandNames())
  
  //Map.addLayer(raw,      {min:0, max:5, palette: palette, bands:['classification']}, 'Raw_' + year, false);
  Map.addLayer(corrigida,{min:0, max:5, palette: palette}, 'Corrigido_' + year, false);
  Map.addLayer(k3,       {min:0, max:5, palette: palette}, 'K3_' + year, false);
  
  var asset_name = 'filter_'+year + '-' + output_version
  
  Export.image.toAsset({
    image:k3.set({'year':year,'step':step,'input_ver':input_version,'output_ver':output_version,'description':desc}), 
    description:asset_name, 
    assetId:'projects/brenomalheiros-ufscar/assets/classification_RMRP/' + asset_name,
    region:geometry, 
    scale:30
  })
});


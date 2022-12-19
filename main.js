import './style.css';
import './node_modules/ol-layerswitcher/src/ol-layerswitcher.css';

import LayerSwitcher from 'ol-layerswitcher';
import colormap from 'colormap';

import GeoTIFF from 'ol/source/GeoTIFF.js';
import Map from 'ol/Map.js';
import TileLayer from 'ol/layer/WebGLTile.js';
import View from 'ol/View.js';
import {getCenter} from 'ol/extent.js';
import OSM from 'ol/source/OSM.js';
import Stamen from 'ol/source/Stamen';
import {Vector as VectorSource} from 'ol/source.js';
import {Vector as VectorLayer} from 'ol/layer.js'
import proj4 from 'proj4';
import {register} from 'ol/proj/proj4.js';
import {getPointResolution, get as getProjection} from 'ol/proj.js';

import Draw from 'ol/interaction/Draw';
import Overlay from 'ol/Overlay';
import {Circle as CircleStyle, Fill, Stroke, Style} from 'ol/style';
import {LineString, Polygon} from 'ol/geom';
import {getArea, getLength} from 'ol/sphere';
import {unByKey} from 'ol/Observable';

import MousePosition from 'ol/control/MousePosition';
import {createStringXY} from 'ol/coordinate';
import {ScaleLine, defaults as defaultControls} from 'ol/control';


// register the projection: EPSG 32634

proj4.defs("EPSG:32634","+proj=utm +zone=34 +datum=WGS84 +units=m +no_defs +type=crs");
register(proj4);

const projection = getProjection('EPSG:32634');


// metadata from https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/34/T/CT/2019/8/S2B_34TCT_20190831_0_L2A/S2B_34TCT_20190831_0_L2A.json
const sourceExtent = [300000.0,5190240.0,409800.0,5300040.0];

// OSM basemap

const osm = new TileLayer({
  source: new OSM(), 
  type: 'base', 
  title: 'OpenStreetMap'
});

// Stamen Basemap
const stamen = new TileLayer({
  source: new Stamen({
    layer: 'toner'
  }), 
  type: 'base', 
  title: 'Stamen Toner Dark'
});

// True Color COG
const source_truecolor = new GeoTIFF({
  sources: [
    {
      url: 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/34/T/CT/2019/8/S2B_34TCT_20190831_0_L2A/TCI.tif',
    },
  ],
});

// creating VectorSource and VectorLater 
const vector_source = new VectorSource();

const vector = new VectorLayer({
  source: vector_source,
  style: {
    'fill-color': 'rgba(255, 255, 255, 0.2)',
    'stroke-color': '#ffcc33',
    'stroke-width': 2,
    'circle-radius': 7,
    'circle-fill-color': '#ffcc33',
  },
});

// Geotiff sources 
const source = new GeoTIFF({
  sources: [
    { // blue reflectance
      url: 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/34/T/CT/2019/8/S2B_34TCT_20190831_0_L2A/B02.tif',
      max: 1000,
    },
    { // green reflectance
      url: 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/34/T/CT/2019/8/S2B_34TCT_20190831_0_L2A/B03.tif',
      max: 1000,
    },
    { // red reflectance
      url: 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/34/T/CT/2019/8/S2B_34TCT_20190831_0_L2A/B04.tif',
      max: 1000,
    },
    { // nir reflectance
      url: 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/34/T/CT/2019/8/S2B_34TCT_20190831_0_L2A/B08.tif',
      max: 1000,
    },
  ],
});

// assign variables to bands from sources

const nir = ['band', 4];
const red = ['band', 3];
const green = ['band', 2];
const blue = ['band', 1];


// compute for NDVI
const difference = ['-', nir, red];
const sum = ['+', nir, red];
const ndvi = ['/', difference, sum];


// compute for NDWI

const differenceNDWI = ['-', green, nir]
const sumNDWI = ['+', green, nir]
const ndwi = ['/', differenceNDWI, sumNDWI]


// color shader for visualization

function getColorStops(name, min, max, steps, reverse) {
  const delta = (max - min) / (steps - 1);
  const stops = new Array(steps * 2);
  const colors = colormap({colormap: name, nshades: steps, format: 'rgba'});
  if (reverse) {
    colors.reverse();
  }
  for (let i = 0; i < steps; i++) {
    stops[i * 2] = min + i * delta;
    stops[i * 2 + 1] = colors[i];
  }
  return stops;
};


// tile layer for NDVI

const layer_ndvi = new TileLayer({
  visible: false,
  title: 'NDVI',
  source: source,
  style: {
    color: [
      'interpolate',
      ['linear'],
      ndvi,
      // color ramp for NDVI values
      ...getColorStops('chlorophyll', -0.2, 1, 10, true),
    ],
  },
});

// tile layer for NDWI

const layer_ndwi = new TileLayer({
  visible: false,
  title: 'NDWI',
  source: source,
  style: {
    color: [
      'interpolate',
      ['linear'],
      ndwi,
      // color ramp for NDWI values
      ...getColorStops('viridis', -1, 1, 10, true),
    ],
  },
});

// tile layer for True Color COG
const true_color = new TileLayer({
  title: "True Color",
  source: source_truecolor,
});

// function to show map coordinates when mouse is hovered 
const mousePositionControl = new MousePosition({
  coordinateFormat: createStringXY(4),
  projection: 'EPSG:32634',
  className: 'custom-mouse-position',
  target: document.getElementById('mouse-position'),
});


// function to draw a vector layer
let sketch;
let helpTooltipElement;
let helpTooltip;
let measureTooltipElement;
let measureTooltip;
const continuePolygonMsg = 'Click to continue drawing the polygon';
const continueLineMsg = 'Click to continue drawing the line';
const pointerMoveHandler = function (evt) {
  if (evt.dragging) {
    return;
  }

  let helpMsg = 'Click to start drawing';

  if (sketch) {
    const geom = sketch.getGeometry();
    if (geom instanceof Polygon) {
      helpMsg = continuePolygonMsg;
    } else if (geom instanceof LineString) {
      helpMsg = continueLineMsg;
    }
  }

  helpTooltipElement.innerHTML = helpMsg;
  helpTooltip.setPosition(evt.coordinate);

  helpTooltipElement.classList.remove('hidden');
};
// end of creating vector function

// create a map view
const OlMap = new Map({
  controls: defaultControls().extend([mousePositionControl]),
  target: 'map',
  layers: [stamen, osm, layer_ndvi,layer_ndwi, true_color, vector],
  view: new View({
    projection: projection,
    center: getCenter(sourceExtent),
    // extent: sourceExtent,
    zoom: 10,
  }),
});


// Vector measurement layer function
OlMap.on('pointermove', pointerMoveHandler);

OlMap.getViewport().addEventListener('mouseout', function () {
  helpTooltipElement.classList.add('hidden');
});

const typeSelect = document.getElementById('type');

let draw; 

const formatLength = function (line) {
  const length = getLength(line);
  let output;
  if (length > 100) {
    output = Math.round((length / 1000) * 100) / 100 + ' ' + 'km';
  } else {
    output = Math.round(length * 100) / 100 + ' ' + 'm';
  }
  return output;
};

const formatArea = function (polygon) {
  const area = getArea(polygon);
  let output;
  if (area > 10000) {
    output = Math.round((area / 1000000) * 100) / 100 + ' ' + 'km<sup>2</sup>';
  } else {
    output = Math.round(area * 100) / 100 + ' ' + 'm<sup>2</sup>';
  }
  return output;
};

function addInteraction() {
  const type = typeSelect.value == 'area' ? 'Polygon' : 'LineString';
  draw = new Draw({
    source: vector_source,
    type: type,
    style: new Style({
      fill: new Fill({
        color: 'rgba(255, 255, 255, 0.2)',
      }),
      stroke: new Stroke({
        color: 'rgba(255, 240, 0)',
        lineDash: [10, 10],
        width: 2,
      }),
      image: new CircleStyle({
        radius: 5,
        stroke: new Stroke({
          color: 'rgba(255, 240, 0)',
        }),
        fill: new Fill({
          color: 'rgba(255, 255, 255, 0.2)',
        }),
      }),
    }),
  });
  OlMap.addInteraction(draw);

  createMeasureTooltip();
  createHelpTooltip();

  let listener;
  draw.on('drawstart', function (evt) {
    sketch = evt.feature;

    let tooltipCoord = evt.coordinate;

    listener = sketch.getGeometry().on('change', function (evt) {
      const geom = evt.target;
      let output;
      if (geom instanceof Polygon) {
        output = formatArea(geom);
        tooltipCoord = geom.getInteriorPoint().getCoordinates();
      } else if (geom instanceof LineString) {
        output = formatLength(geom);
        tooltipCoord = geom.getLastCoordinate();
      }
      measureTooltipElement.innerHTML = output;
      measureTooltip.setPosition(tooltipCoord);
    });
  });

  draw.on('drawend', function () {
    measureTooltipElement.className = 'ol-tooltip ol-tooltip-static';
    measureTooltip.setOffset([0, -7]);
    sketch = null;
    measureTooltipElement = null;
    createMeasureTooltip();
    unByKey(listener);
  });
}

function createHelpTooltip() {
  if (helpTooltipElement) {
    helpTooltipElement.parentNode.removeChild(helpTooltipElement);
  }
  helpTooltipElement = document.createElement('div');
  helpTooltipElement.className = 'ol-tooltip hidden';
  helpTooltip = new Overlay({
    element: helpTooltipElement,
    offset: [15, 0],
    positioning: 'center-left',
  });
  OlMap.addOverlay(helpTooltip);
}

function createMeasureTooltip() {
  if (measureTooltipElement) {
    measureTooltipElement.parentNode.removeChild(measureTooltipElement);
  }
  measureTooltipElement = document.createElement('div');
  measureTooltipElement.className = 'ol-tooltip ol-tooltip-measure';
  measureTooltip = new Overlay({
    element: measureTooltipElement,
    offset: [0, -15],
    positioning: 'bottom-center',
    stopEvent: false,
    insertFirst: false,
  });
  OlMap.addOverlay(measureTooltip);
}

typeSelect.onchange = function () {
  OlMap.removeInteraction(draw);
  addInteraction();
};

addInteraction();

// end of vector measurement layer function

// export map to PDF

const scaleLine = new ScaleLine({bar: true, text: true, minWidth: 125});
OlMap.addControl(scaleLine);

const dims = {
  a0: [1189, 841],
  a1: [841, 594],
  a2: [594, 420],
  a3: [420, 297],
  a4: [297, 210],
  a5: [210, 148],
};

// export options for html2canvase.
const exportOptions = {
  useCORS: true,
  ignoreElements: function (element) {
    const className = element.className || '';
    return (
      className.includes('ol-control') &&
      !className.includes('ol-scale') &&
      (!className.includes('ol-attribution') ||
        !className.includes('ol-uncollapsible'))
    );
  },
};

const exportButton = document.getElementById('export-pdf');

exportButton.addEventListener(
  'click',
  function () {
    exportButton.disabled = true;
    document.body.style.cursor = 'progress';

    const format = document.getElementById('format').value;
    const resolution = document.getElementById('resolution').value;
    const scale = document.getElementById('scale').value;
    const dim = dims[format];
    const width = Math.round((dim[0] * resolution) / 25.4);
    const height = Math.round((dim[1] * resolution) / 25.4);
    const viewResolution = OlMap.getView().getResolution();
    const scaleResolution =
      scale /
      getPointResolution(
        OlMap.getView().getProjection(),
        resolution / 25.4,
        OlMap.getView().getCenter()
      );

    OlMap.once('rendercomplete', function () {
      exportOptions.width = width;
      exportOptions.height = height;
      html2canvas(OlMap.getViewport(), exportOptions).then(function (canvas) {
        const pdf = new jspdf.jsPDF('landscape', undefined, format);
        pdf.addImage(
          canvas.toDataURL('image/jpeg'),
          'JPEG',
          0,
          0,
          dim[0],
          dim[1]
        );
        pdf.save('map.pdf');
        // Reset original map size
        scaleLine.setDpi();
        OlMap.getTargetElement().style.width = '';
        OlMap.getTargetElement().style.height = '';
        OlMap.updateSize();
        OlMap.getView().setResolution(viewResolution);
        exportButton.disabled = false;
        document.body.style.cursor = 'auto';
      });
    });

    // Set print size
    scaleLine.setDpi(resolution);
    OlMap.getTargetElement().style.width = width + 'px';
    OlMap.getTargetElement().style.height = height + 'px';
    OlMap.updateSize();
    OlMap.getView().setResolution(scaleResolution);
  },
  false
);
// end of export map to PDF

// LayerSwitcher control
OlMap.addControl(new LayerSwitcher());

// opacity function
const opacityInput = document.getElementById('opacity-input');
const opacityOutput = document.getElementById('opacity-output');
function update() {
  const opacity = parseFloat(opacityInput.value);
  layer_ndvi.setOpacity(opacity);
  layer_ndwi.setOpacity(opacity);
  true_color.setOpacity(opacity);
  opacityOutput.innerText = opacity.toFixed(2);
}
opacityInput.addEventListener('input', update);
update();
#!/usr/bin/env python

import argparse
import sys
from io import BytesIO
import base64

import json

import chart as charts
import data_source as data_sources
import urllib

group_by_functions = {
    'sum': lambda series_group_by: series_group_by.sum(),
    'max': lambda series_group_by: series_group_by.max(numeric_only=True),
    'min': lambda series_group_by: series_group_by.min(numeric_only=True),
    'prod': lambda series_group_by: series_group_by.prod(),
    'first': lambda series_group_by: series_group_by.first(),
    'last': lambda series_group_by: series_group_by.last(),
}

parser = argparse.ArgumentParser(
    formatter_class=lambda prog: argparse.HelpFormatter(prog, max_help_position=80, width=130)
)

parser.add_argument('--x-axis', help='Chart X axis', nargs='+', type=str, required=True)
parser.add_argument('--y-axis', help='Chart Y axis', nargs='+', type=str, required=True)
parser.add_argument(
    '--x-select',
    help='x axis data values ​​selected for rendering',
    nargs='+',
    type=str
)
parser.add_argument(
    '--y-select',
    help='y axis data values ​​selected for rendering',
    nargs='+',
    type=str
)
parser.add_argument('--data', help='Url or path of file with data. Only formats csv and json')
parser.add_argument('--chart-type', help='Chart type', default='line', choices=list(charts.chart_constructors.keys()))
parser.add_argument('--chart-name', help='Chart name', default='Chart name')
parser.add_argument('--chart-file-name', help='Chart file name')
parser.add_argument('--as-json', default=False, action='store_true', help='Print result as json')
parser.add_argument('--group-by', help='Print result as json')
parser.add_argument('--group-by-func', help='Grouping function', choices=list(group_by_functions.keys()), default="sum")

args = parser.parse_args()

if args.chart_file_name is None:
    args.chart_file_name = args.chart_name

data_source = None

if args.data is not None:
    data_source = data_sources.UrlDataSource(args.data)
elif not sys.stdin.isatty():
    data_source = data_sources.StdinDataSource(sys.stdin.read())
else:
    print(
        'Especifique el contenido de los datos mediante el argumento --data o < NOMBRE FICHERO',
        file=sys.stderr,
        end=''
    )
    sys.exit(1)

try:
    csv_data = data_source.get_data()
except FileNotFoundError:
    print('No se ha encontrado el fichero especificado', file=sys.stderr, end='')
    sys.exit(1)
except urllib.error.HTTPError:
    print('Datos no encontrados mediante URL', file=sys.stderr, end='')
    sys.exit(1)

# Se comprueba si los campos seleccionados para los ejes están presentes en el header del csv
x_axis_name = args.x_axis
y_axis_name = args.y_axis

if len(x_axis_name) > 1 and len(y_axis_name) > 1:
    print('Sólo puede especificar múltiples campos para un eje')
    sys.exit(1)

for name in x_axis_name:
    if name not in csv_data.columns:
        print('Seleccione un valor del listado para X axis:', csv_data.columns.to_list(), file=sys.stderr, end='')
        sys.exit(1)

for name in y_axis_name:
    if name not in csv_data.columns:
        print('Seleccione un valor del listado para Y axis:', csv_data.columns.to_list(), file=sys.stderr, end='')
        sys.exit(1)


# BEGIN Agrupación de los datos
group_by = None

if args.chart_type == 'scatter':
    group_by = args.group_by
elif args.chart_type == 'line' or args.chart_type == 'bar':
    group_by = x_axis_name[0]
    if len(x_axis_name) > 1:
        group_by = y_axis_name[0]

if group_by is not None:
    csv_data = group_by_functions[args.group_by_func](csv_data.groupby(group_by, as_index=False))

# END Agrupación de los datos


if args.x_select is not None:
    csv_data = csv_data[csv_data[x_axis_name[0]].isin(args.x_select)]

if args.y_select is not None:
    csv_data = csv_data[csv_data[y_axis_name[0]].isin(args.y_select)]


chartConstructor = charts.chart_constructors.get(args.chart_type)
chart = chartConstructor(x_axis_name, y_axis_name, csv_data)
chartImage = chart.generate_chart(args.chart_name)

if args.as_json:
    imageFile = BytesIO()
    chartImage.savefig(imageFile, format='png', bbox_inches='tight')
    imageFile.seek(0)

    result = {
        'imageBase64': base64.b64encode(imageFile.getvalue()).decode('utf8'),
        'sourceData': json.loads(csv_data.to_json(orient='table'))
    }
    print(json.dumps(result), end='')

else:
    # Renderiza la imagen al completo (bbox_inches='tight') -> https://stackoverflow.com/a/39089653
    chartImage.savefig(args.chart_file_name, bbox_inches='tight')



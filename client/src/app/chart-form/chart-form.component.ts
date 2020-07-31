import { Component, Output, EventEmitter } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import * as papaparse from 'papaparse';
import { DataService } from '../core/data.service';
import { ChartService } from '../core/chart.service';
import { IChartImportedData, GROUP_BY_FUNCTIONS, CHART_TYPES, ChartTypeEnum, GroupByFunctionEnum } from '../core/chart.model';
import { finalize } from 'rxjs/operators';
import { NbToastrService } from '@nebular/theme';

@Component({
    selector: 'app-chart-form',
    templateUrl: './chart-form.component.html',
    styleUrls: ['./chart-form.component.scss']
})
export class ChartFormComponent {
    public formSourceData: FormGroup;
    public formArguments: FormGroup;

    public data: any;
    public fields: string[] = [];

    public loadingData: boolean = false;
    public loadingChart: boolean = false;
    public chartTypes = CHART_TYPES;
    public groupByFunctions = GROUP_BY_FUNCTIONS;

    @Output()
    public getChart: EventEmitter<any> = new EventEmitter();

    @Output()
    public getData: EventEmitter<IChartImportedData> = new EventEmitter();

    @Output()
    public argumentsChange: EventEmitter<any> = new EventEmitter();

    private formArgumentsInitialValues: any;


    public ySelectOptions: string[] = [];
    public xSelectOptions: string[] = [];
    constructor(
        private fb: FormBuilder,
        private readonly dataService: DataService,
        private readonly chartService: ChartService,
        private readonly toastrService: NbToastrService
    ) {}

    ngOnInit() {
        this.formSourceData = this.fb.group({
            url: [null, Validators.required ],
            dataBase64: [ null ]
        })

        this.formArguments = this.fb.group({
            xAxis: [ [], Validators.required ],
            yAxis: [ [], Validators.required ],
            chartType: [ ChartTypeEnum.LINE, Validators.required ],
            groupByFunction: [ GroupByFunctionEnum.SUM ],
            groupBy: [null],
            xSelect: [[]],
            ySelect: [[]]
        });

        this.formArgumentsInitialValues = this.formArguments.value;

        const { 
            xAxis: xAxisControl,
            yAxis: yAxisControl,
            xSelect: xSelectControl,
            ySelect: ySelectControl,
            groupBy: groupByControl
        } = this.formArguments.controls;

        const xAxisControlValueChangesHandler = value => {
            if (value.length == 1) {
                xSelectControl.enable({ emitEvent: false });
                const [xName] = value
                const options = new Set<string>();
                this.data.forEach(row => options.add( row[xName] ) );
                this.xSelectOptions = Array.from(options);

                // Para evitar Can't assign single value if select is marked as multiple
                // y para esperar que las opciones se rendericen primero
                setTimeout(() => {
                    xSelectControl.setValue(this.xSelectOptions, { emitEvent: false });
                }, 0)
            }
            else {
                xSelectControl.disable({ emitEvent: false });
            }

            yAxisControlValueChangesHandler(yAxisControl.value);
        };
        xAxisControl.valueChanges.subscribe(xAxisControlValueChangesHandler);

        const yAxisControlValueChangesHandler = (value) => {
            if (value.length == 1 && !xSelectControl.enabled) {
                ySelectControl.enable({ emitEvent: false });
                const [xName] = value
                const options = new Set<string>();
                this.data.forEach(row => options.add( row[xName] ) );
                this.ySelectOptions = Array.from(options);

                setTimeout(() => {
                    ySelectControl.setValue(this.ySelectOptions, { emitEvent: false });
                }, 0)
            }
            else {
                ySelectControl.disable({ emitEvent: false });
            }
        }
        yAxisControl.valueChanges.subscribe(yAxisControlValueChangesHandler);

        this.formArguments.valueChanges.subscribe(values => {
            const { chartType, xAxis, yAxis } = values;
            if (chartType == ChartTypeEnum.LINE || chartType == ChartTypeEnum.BAR) {
                groupByControl.disable({emitEvent: false});

                if (Array.isArray(xAxis) && xAxis.length > 1) {
                    if (yAxis) {
                        groupByControl.setValue(yAxis[0], { emitEvent: false });
                    }
                }
                else if (xAxis.length == 1) {
                    groupByControl.setValue(xAxis[0], { emitEvent: false });
                }
            }
            else if (chartType == ChartTypeEnum.SCATTER){
                groupByControl.enable({emitEvent: false});
                groupByControl.setValue(null, { emitEvent: false });
            }

            this.argumentsChange.emit(values);
        })
    }

    public onFormDataSubmit() {
        const { url } = this.formSourceData.value;

        this.loadingData = true;
        this.dataService.getFromUrl(url)
            .pipe(
                finalize(() => {
                    this.loadingData = false;
                })
            )
            .subscribe(
                data => {
                    this.parseData(data);
                    this.formSourceData.get('dataBase64').setValue(null);
                },
                err => {
                    this.toastrService.show(err.message || 'Error desconocido', 'Error al obtener los datos', {status: 'danger', duration: 4000, destroyByClick: true})
                }
            );
        
    }

    public onArgumentsSubmit() {
        const chartArguments = {
            ...this.formSourceData.value,
            ...this.formArguments.value
        }
        this.loadingChart = true;

        this.chartService.getChart(chartArguments)
            .pipe(
                finalize(() => {
                    this.loadingChart = false;
                })
            )
            .subscribe(
                res => {
                    this.getChart.emit({
                        response: res,
                        chartArguments: chartArguments
                    });
                },
                (err: {error: string, message: string, statusCode: number}) => {
                    console.log('Error:', err.message);
                    this.toastrService.show(err.message || 'Error desconocido', 'Error al obtener el gráfico', {status: 'danger', duration: 4000, destroyByClick: true})
                }
            )

        
    }

    public onFileChange(event) {
        if (!(event.target.files && event.target.files.length > 0)) return;
        const readerText = new FileReader();
        const readerCsv = new FileReader();
        const file = event.target.files[0];

        readerText.readAsText(file);
        readerCsv.readAsDataURL(file);

        readerText.onload = () => {  
            const data = readerText.result;
            this.parseData(data.toString());
        }; 

        readerCsv.onload = () => {
            const base64 = readerCsv.result.toString().split(',')[1];
            this.formSourceData.get('dataBase64').setValue({
                filename: file.name,
                filetype: file.type,
                value: base64
            });
            this.formSourceData.get('url').setValue(null);
        };
    }

    private parseData(dataString: string) {
        let data: {[key: string]: any}[] = [], fields: string[] = [];
        try {
            const jsonData = JSON.parse(dataString);
            fields = Object.keys(jsonData);
            const numberRows = jsonData[fields[0]].length;
            data = [];

            for (let i = 0; i < numberRows; i++) {
                data.push(fields.reduce((dataRow, field) => {
                    dataRow[field] = jsonData[field][i];
                    return dataRow;
                }, {}))
            }
        }
        catch (e) {
            const csvData = papaparse.parse(dataString, {header: true, delimiter: ',', skipEmptyLines: true});
            data = csvData.data;
            fields = csvData.meta.fields
        }

        this.data = data;
        this.fields = fields;

        this.formArguments.reset(this.formArgumentsInitialValues);
        this.getData.emit({
            headers: fields,
            rows: data as any
        });
    }
}
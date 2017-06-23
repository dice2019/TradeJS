import {forEach, random, throttle} from 'lodash';
import {
	Component, OnDestroy, ElementRef, Input, ViewChild,
	OnInit, AfterViewInit, ChangeDetectionStrategy, ViewEncapsulation, ContentChild, NgZone, Output, EventEmitter
} from '@angular/core';

import {DialogComponent} from '../dialog/dialog.component';
import {IndicatorModel} from '../../models/indicator';
import {InstrumentsService} from '../../services/instruments.service';
import {CookieService} from 'ngx-cookie';
import {DialogAnchorDirective} from '../../directives/dialoganchor.directive';
import {InstrumentModel} from '../../../../shared/models/InstrumentModel';
import * as interact from 'interactjs';
import {BehaviorSubject} from 'rxjs/BehaviorSubject';
import {CacheService} from '../../services/cache.service';
import {Base} from '../../../../shared/classes/Base';

declare let $: any;

@Component({
	selector: 'chart-box',
	templateUrl: './chart-box.component.html',
	styleUrls: ['./chart-box.component.scss'],
	encapsulation: ViewEncapsulation.Native,
	changeDetection: ChangeDetectionStrategy.OnPush,
	entryComponents: [DialogComponent],
	host: {
		'[class.className]' : 'className',
		'[class]' : 'classNames'
	}
})

export class ChartBoxComponent implements OnInit, OnDestroy, AfterViewInit {

	public static readonly DEFAULT_CHUNK_LENGTH = 1000;
	public static readonly VIEW_STATE_WINDOWED = 1;
	public static readonly VIEW_STATE_STRETCHED = 2;
	public static readonly VIEW_STATE_MINIMIZED = 3;

	@Input() model: InstrumentModel;
	@Output() loading$ = new BehaviorSubject(true);
	
	@ViewChild(DialogAnchorDirective) private _dialogAnchor: DialogAnchorDirective;
	@ViewChild('draghandle') private _dragHandle: ElementRef;
	
	$el: any;

	@Input() public viewState = 'windowed';

	private _data = {
		candles: [],
		indicators: [],
		orders: []
	};

	private minimized = false;

	private _offset = 0;
	private _scrollOffset = -1;
	private _scrollSpeedStep = 6;
	private _scrollSpeedMin = 1;
	private _scrollSpeedMax = 20;

	private _chart: any;
	private _chartEl: HTMLElement = null;
	private _onScrollBounced: Function = null;
	private _queuedData: any = null;

	constructor(public _instrumentsService: InstrumentsService,
				private _zone: NgZone,
				private _cacheService: CacheService,
				private _cookieService: CookieService,
				private _elementRef: ElementRef) {
	}

	ngOnInit() {
		this.$el = $(this._elementRef.nativeElement);

		this.toggleViewState(this.viewState);

		if (this.viewState === 'windowed')
			this.restoreStyles();

		this._bindResize();

		this._onScrollBounced = throttle(this._onScroll.bind(this), 33);

		this._chartEl = this._elementRef.nativeElement.shadowRoot.lastElementChild;
		this._chartEl.addEventListener('mousewheel', <any>this._onScrollBounced);

		this._fetchCandles();

		if (this.model.options.id) {
			this._fetchIndicators(ChartBoxComponent.DEFAULT_CHUNK_LENGTH, this._offset);
		} else {
			let subscription = this.model.changed$.subscribe(() => {
				if (this.model.options.id) {
					subscription.unsubscribe();
					this._fetchIndicators(ChartBoxComponent.DEFAULT_CHUNK_LENGTH, this._offset);
				}
			});
		}

		this.model.changed$.subscribe(changes => {
			changes.forEach(change => {
				switch (change) {
					// case 'zoom':
					// 	if (this._chart)
					// 		this._updateViewPort();
					// 	break;
					case 'graphType':
						this.changeGraphType(this.model.options.graphType);
						break;
					// case 'timeFrame':
					// 	this.toggleTimeFrame(changes[key]);
					// 	break;
					// case 'indicator':
					// 	let change = changes[key];
					// 	if (change.type === 'add') {
					// 		let indicator = this.model.options.indicators.find(i => i.id === change.id);
					//
					// 		// this._updateIndicators([indicator]);
					// 	}
					// 	break;
				}
			});
		});
	}

	ngAfterViewInit() {
		this.putOnTop();
		this._bindDrag();

		this.model.changed$.subscribe((changes: any) => {
			if (changes.indexOf('focus') > -1) {
				this.toggleViewState(true);
				this.putOnTop();
			}
		});
	}

	public changeGraphType(type) {
		if (!this._chart)
			return;

		this._chart.options.data[0].type = type;
		this._chart.render();
	}

	public pinToCorner(edges): void {
		let el = this._chart.container;

		el.style.position = 'absolute';

		if (edges.right || edges.left) {
			el.style.left = 'auto';
			el.style.right = 0;
		}
	}

	public unpinFromCorner(reflow = true): void {
		this._chart.container.style.position = 'static';

		if (reflow)
			this.reflow();
	}

	public reflow() {
		if (!this._chart)
			return;

		this._chart.options.height = this._elementRef.nativeElement.clientHeight;
		this._chart.options.width = this._elementRef.nativeElement.clientWidth;

		this._updateViewPort();
	}

	public render() {
		if (!this._chart)
			return;

		this._chart.render();
		console.log('RENDER CALLED!');
	}

	public toggleTimeFrame(timeFrame) {
		// this._toggleLoading(true);
		// this._createChart();
		// this._toggleLoading(false);
	}

	private _createChart() {
		this._zone.runOutsideAngular(() => {

			this._destroyChart();

			let chartOptions = {
				interactivityEnabled: true,
				exportEnabled: false,
				animationEnabled: false,
				backgroundColor: '#000',
				toolTip:{
					animationEnabled: false,
				},
				axisY: {
					includeZero: false,
					// title: 'Prices',
					// prefix: '$',
					labelFontColor: '#fff',
					labelFontSize: '12',
					gridDashType: 'dash',
					gridColor: '#787D73',
					gridThickness: 1,
					stripLines: [{
						value: 0,
						label: ''
					}]
				},
				axisX: {
					includeZero: false,
					labelFontColor: '#fff',
					labelFontSize: '12',
					gridDashType: 'dash',
					gridColor: '#787D73',
					gridThickness: 1
				},
				data: [
					{
						type: this.model.options.graphType,
						connectNullData: true,
						risingColor: '#17EFDA',
						dataPoints: this._data.candles
					}
				]
			};

			this._chart = new window['CanvasJS'].Chart(this._chartEl, chartOptions);

			this._updateViewPort();
			this._updateIndicators();
		});
	}

	private _updateViewPort(shift = 0) {
		this._zone.runOutsideAngular(() => {
			if (!this._chart || !this._chart.options.data[0].dataPoints.length)
				return;

			let data = this._chart.options.data[0].dataPoints,
				offset = this._scrollOffset + shift,
				viewable = this._calculateViewableBars(),
				minOffset = 0,
				maxOffset = data.length - 1 - viewable,
				min, max;

			if (offset > maxOffset)
				offset = maxOffset;
			else if (offset < minOffset)
				offset = minOffset;

			this._scrollOffset = offset;

			min = data[data.length - offset - viewable];
			max = data[data.length - offset - 1];

			if (min && max) {
				this._chart.options.axisX.viewportMinimum = min.x;
				this._chart.options.axisX.viewportMaximum = max.x
			}
		});
	}

	private _fetchCandles() {
		this._zone.runOutsideAngular(async () => {
			try {
				let data:any = ChartBoxComponent._prepareData(await this._cacheService.read({
					symbol: this.model.options.symbol,
					timeFrame: this.model.options.timeFrame,
					until: this.model.options.type === 'backtest' ? this.model.options.from :  this.model.options.until,
					count: ChartBoxComponent.DEFAULT_CHUNK_LENGTH,
					offset: this._offset
				}));

				this._data.candles.push(...data.candles);

				if (!this._chart)
					this._createChart();

				this._updateCurrentPricePlot();
				this._updateViewPort();
				this.render();
			} catch (error) {
				this.loading$.next(false);
				console.log('error error error', error);
			}
		});
	}

	private _updateCurrentPricePlot(): void {
		this._zone.runOutsideAngular(() => {
			let lastCandle = this._data.candles[this._data.candles.length - 1];

			if (!lastCandle)
				return;

			this._chart.options.axisY.stripLines[0].value = lastCandle.y[2];
			this._chart.options.axisY.stripLines[0].label = lastCandle.y[2];
		});
	}

	private _fetchIndicators(count: number, offset: number) {
		this._zone.runOutsideAngular(async () => {
			let data;

			if (this.model.options.type === 'backtest')
				data = await this._instrumentsService.fetch(this.model, count, offset, undefined, this.model.options.from);
			else
				data = await this._instrumentsService.fetch(this.model, count, offset);

			if (!data.indicators.length)
				return;

			// Prepare data
			data.indicators.forEach(indicator => {
				indicator.buffers.forEach(drawBuffer => {
					drawBuffer.data = drawBuffer.data.map(point => ({
						x: new Date(point[0]),
						y: point[1]
					}));
				});
			});

			this._data.indicators = data.indicators;

			this._updateIndicators();

			if (this._chart)
				this.render();
		});
	}

	private _updateIndicators() {
		if (!this._chart)
			return;

		this._zone.runOutsideAngular(() => {
			this._data.indicators.forEach(indicator => {
				indicator.buffers.forEach(drawBuffer => {
					// New series
					let series = null; // this._chart.get(unique);

					// Update
					if (series) {
						console.log('SERIES!!!!', series);
					}

					// Create
					else {
						switch (drawBuffer.type) {
							case 'line':
								this._chart.options.data.push({
									type: drawBuffer.type,
									color: drawBuffer.style.color,
									name: indicator.id,
									dataPoints: drawBuffer.data
								});
								break;
							case 'arrow':
								alert('cannot yet draw arrow');
								break;
						}
					}
				});
			});
		});
	}

	private _updateOrders(orders: Array<any>) {
		this._zone.runOutsideAngular(() => {
			this._chart.get('orders').setData(orders.map(order => [order.openTime, order.bid, null]));
		});
	}

	/*
	 Stop highchart from moving the Y axis so much
	 TODO: improve
	 */
	private _getSurroundingPriceRange(padding = 200, viewable) {
		let data = this._chart.series[0].yData,
			i = data.length - this._scrollOffset - viewable - padding,
			len = (data.length - this._scrollOffset) + padding,
			price, low, high;

		if (i < 0)
			i = 0;

		if (len > data.length)
			len = data.length;

		for (; i < len; ++i) {
			price = data[i][0];
			if (!high || price > high) {
				high = price;
			} else if (!low || price < low) {
				low = price;
			}
		}

		return {low, high};
	}

	private _calculateViewableBars(checkParent = true) {
		let el = this._elementRef.nativeElement,
			barW = 3 * this.model.options.zoom;

		return Math.floor(el.clientWidth / barW);
	}

	private _onScroll(event: MouseWheelEvent): boolean {
		event.stopPropagation();
		event.preventDefault();

		let shift = Math.ceil(this._calculateViewableBars() / this._scrollSpeedStep);

		if (shift < this._scrollSpeedMin)
			shift = this._scrollSpeedMin;
		else if (shift > this._scrollSpeedMax)
			shift = this._scrollSpeedMax;

		this._updateViewPort(event.wheelDelta > 0 ? -shift : shift);

		this.render();

		return false;
	}

	static _prepareData(data: any) {
		let i = 0,
			rowLength = 10,
			length = data.length,
			volume = new Array(length / rowLength),
			candles = new Array(length / rowLength);

		// TODO - Volume
		for (; i < length; i += rowLength)
			candles[i / rowLength] = {x: new Date(data[i]), y: [data[i + 1], data[i + 3], data[i + 5], data[i + 7]]};

		return {
			candles: candles,
			volume: volume
		};
	}

	public showIndicatorOptionsMenu(indicatorModel: IndicatorModel): Promise<boolean> {

		return new Promise((resolve) => {

			this._dialogAnchor.createDialog(DialogComponent, {
				title: indicatorModel.name,
				model: indicatorModel,
				buttons: [
					{value: 'add', text: 'Add', type: 'primary'},
					{text: 'Cancel', type: 'default'}
				],
				onClickButton(value) {
					if (value === 'add') {
						resolve(true);
					} else
						resolve(false);
				}
			});
		});
	}

	public putOnTop() {
		let selfIndex = parseInt(this.$el.css('z-index'), 10) || 1,
			highestIndex = selfIndex;

		this.$el.siblings().each((key, el) => {
			let zIndex = parseInt(el.style.zIndex, 10) || 1;

			if (zIndex > highestIndex)
				highestIndex = zIndex;
		});

		this.$el.css('z-index', selfIndex <= highestIndex ? highestIndex + 1 : highestIndex);
	}

	public getStyles(): any {
		return {
			x: parseInt(this._elementRef.nativeElement.getAttribute('data-x'), 10) || 0,
			y: parseInt(this._elementRef.nativeElement.getAttribute('data-y'), 10) || 0,
			z: parseInt(this._elementRef.nativeElement.style.zIndex, 10) || 1,
			w: this._elementRef.nativeElement.clientWidth,
			h: this._elementRef.nativeElement.clientHeight
		};
	}

	public setStyles(styles?: {x?: any, y?: any, z?: any, w?: any, h?: any}, redraw = false): void {
		let diffs = Base.getObjectDiff(styles, this.getStyles()),
			obj: any = {};

		if (!diffs.length)
			return;

		// Filter out changes
		diffs.forEach(key => {
			switch (key) {
				case 'x':
				case 'y':
					this._elementRef.nativeElement.setAttribute('data-x', styles.x);
					this._elementRef.nativeElement.setAttribute('data-y', styles.y);
					obj.transform = `translate(${styles.x}px, ${styles.y}px)`;
					break;
				case 'z':
					obj.zIndex = styles[key];
					break;
				case 'w':
				case 'h':
					obj.width = parseInt(styles.w, 10) + 'px';
					obj.height = parseInt(styles.h, 10) + 'px';

					if (redraw) {
						this._elementRef.nativeElement.classList.add('black');

						setTimeout(() => {
							this._updateViewPort();
							this.render();
							this._elementRef.nativeElement.classList.remove('black');
						}, 0);
					}
					break;
			}
		});

		Object.assign(this._elementRef.nativeElement.style, obj);

		this.storeStyles();
	}

	public storeStyles() {
		if (this.model.options.id)
			this._cookieService.putObject(`instrument-${this.model.options.id}-p`, this.getStyles())
	}

	public restoreStyles(styles?: {x?: any, y?: any, z?: any, w?: any, h?: any}): void {
		styles = styles || <any>this._cookieService.getObject(`instrument-${this.model.options.id}-p`);

		if (styles) {
			this.setStyles(styles);
		}
		else {
			this.setRandomPosition();
			this.storeStyles();
		}
	}

	public setRandomPosition() {
		let el = this._elementRef.nativeElement,
			containerH = el.parentNode.host.clientHeight,
			containerW = el.parentNode.host.clientWidth,
			chartH = el.clientHeight,
			chartW = el.clientWidth;

		this.setStyles({
			x: random(0, containerW - chartW),
			y: Math.max(random(0, containerH - chartH), 0)
		});
	}

	public toggleViewState(viewState: string | boolean, reflow = false) {
		let elClassList = this._elementRef.nativeElement.classList;

		if (typeof viewState === 'string') {

			if (this.viewState !== viewState) {

				elClassList.remove(this.viewState);
				elClassList.add(viewState);

				this.viewState = viewState;

				if (reflow)
					this.render();
			}
		} else {
			elClassList.toggle('minimized', !viewState);
		}
	}

	private _bindDrag() {

		this._zone.runOutsideAngular(() => {

			interact(this._dragHandle.nativeElement)
				.draggable({

					allowFrom: this._dragHandle.nativeElement,

					// enable inertial throwing
					inertia: true,

					// keep the element within the area of it's parent
					restrict: {
						restriction: this._elementRef.nativeElement.parentNode.host,
						endOnly: true,
						elementRect: {top: 0, left: 0, bottom: 1, right: 1}
					},

					// call this function on every dragmove event
					onmove: (event) => {
						event.preventDefault();

						this._zone.runOutsideAngular(() => {

							let target = this._elementRef.nativeElement;

							let // keep the dragged position in the data-x/data-y attributes
								x = (parseFloat(target.getAttribute('data-x')) || 0) + event.dx,
								y = (parseFloat(target.getAttribute('data-y')) || 0) + event.dy;

							// translate the element
							target.style.transform = 'translate(' + x + 'px, ' + y + 'px)';

							// update the posiion attributes
							target.setAttribute('data-x', x);
							target.setAttribute('data-y', y);
						});
					},
					onend: () => this.storeStyles(),
				});
		});
	}

	private _bindResize() {
		interact(this._elementRef.nativeElement)
			.resizable({
				preserveAspectRatio: false,
				edges: {left: true, right: true, bottom: true, top: false},
				min: 100,
				restrict: {
					restriction: 'parent'
				},
				onstart: (event) => this.pinToCorner(event),
				onmove: (event) => {
					event.preventDefault();
					event.stopPropagation();

					if (event.rect.height < 100 || event.rect.width < 300)
						return;

					let target = event.target,
						x = (parseFloat(target.getAttribute('data-x')) || 0),
						y = (parseFloat(target.getAttribute('data-y')) || 0);

					if (event.rect.height < 100 || event.rect.width < 300)
						return;


					// update the element's style
					target.style.width = event.rect.width + 'px';
					target.style.height = event.rect.height + 'px';

					// translate when resizing from top or left edges
					x += event.deltaRect.left;
					y += event.deltaRect.top;

					target.style.webkitTransform = target.style.transform =
						'translate(' + x + 'px,' + y + 'px)';

					target.setAttribute('data-x', x);
					target.setAttribute('data-y', y);
				},
				onend: () => {
					this.unpinFromCorner();
					// this.changed.next();
				}
			});
	}

	private _destroyChart() {
		this._chartEl.removeEventListener('mousewheel', <any>this._onScrollBounced);

		if (this._chart)
			this._chart.destroy();
	}

	async ngOnDestroy() {
		this._destroyChart();
	}
}
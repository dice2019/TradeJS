import {Injectable, NgZone, Output} from '@angular/core';
import {BehaviorSubject} from 'rxjs';
import * as io from 'socket.io-client';
import {Subject} from 'rxjs/Subject';
import {BaseModel} from '../models/base.model';

export class CacheSymbol extends BaseModel {
	public price$: Subject<any> = new Subject();

	public tick(ticks) {
		ticks.forEach(tick => {
			this.set({
				direction: this.options.bid > tick[1] ? 'down' : 'up',
				bidDirection: this.options.bid > tick[1] ? 'down' : 'up',
				bid: tick[1],
				askDirection: this.options.ask > tick[2] ? 'down' : 'up',
				ask: tick[2]
			}, false, true);
		});

		this.price$.next(true);
	}
}

@Injectable()
export class CacheService {

	@Output() public symbolList$: BehaviorSubject<Array<CacheSymbol>> = new BehaviorSubject([]);
	@Output() public changed$: Subject<any> = new Subject();

	private _socket: any;

	constructor(private _zone: NgZone) {
	}

	public init(): void {
		this._connect();

		this._socket.on('ticks', ticks => {

			this._zone.runOutsideAngular(() => {
				for (let _symbol in ticks) {
					let symbol = this.getBySymbol(_symbol);

					if (symbol)
						symbol.tick(ticks[_symbol]);
				}

				this.changed$.next(Object.keys(ticks));
			});
		});
	}

	public read(params) {
		return new Promise((resolve, reject) => {
			this._socket.emit('read', params, (err, buffer: Uint8Array) => {
				if (err)
					return reject(err);

				let arr = new Float64Array(buffer);

				resolve(arr);
			});
		})
	}

	private _connect() {
		this._zone.runOutsideAngular(() => {
			this._socket = io('/', {
				'reconnectionAttempts': 10, // avoid having user reconnect manually in order to prevent dead clients after a server restart
				'timeout': 10000, // before connect_error and connect_timeout are emitted.
				'transports': ['websocket'],
				path: '/candles'
			});
		});
	}

	public loadSymbolList() {
		// Create symbol class for each symbol

		let cacheSymbols = window['symbols'].map(symbol => {
			return new CacheSymbol({
				direction: 'up',
				name: symbol.name,
				bidDirection: 'up',
				bid: symbol.bid,
				ask: symbol.ask,
				askDirection: 'up',
				favorite: symbol.favorite
			});
		});

		this._socket.emit('symbol:list', {}, (err, symbolList) => {
			if (err)
				return console.error(err);

			symbolList.forEach(symbol => {
				const cSymbol = cacheSymbols.find(cs => cs.options.name === symbol.name);

				cSymbol.set({
					bid: symbol.bid,
					ask: symbol.ask
				});
			});
		});

		this.symbolList$.next(cacheSymbols);
	}

	public add(model) {
		return model;
	}

	public getBySymbol(symbol: string) {
		return this.symbolList$.getValue().find(_symbol => _symbol.options.name === symbol)
	}

	public getByText(text: string) {
		text = text.trim().toLowerCase();
		const regex = new RegExp(text, 'i');
		return this.symbolList$.getValue().filter(symbol => symbol.options.name.toLowerCase().indexOf(text) > -1);
	}
}
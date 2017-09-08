import {json, urlencoded} from 'body-parser';
import * as express from 'express';
import * as helmet from 'helmet';
import * as morgan from 'morgan';

const config = require('../../tradejs.config');
const app = express();
const server = app.listen(config.server.channel.port, () => console.log(`\n Channel service started on      : 127.0.0.1:${config.server.channel.port}`));

/**
 * Express
 */
app.use(morgan('dev'));
app.use(helmet());

app.use(function (req, res, next) {
	res.header('Access-Control-Allow-Origin', '*');
	res.header('Access-Control-Allow-Headers', '_id, Authorization, Origin, X-Requested-With, Content-Type, Accept');
	next();
});

/**
 * Add 'user' variable to request, holding userID
 */
app.use((req: any, res, next) => {
	let userID = req.headers['_id'];

	if (!userID)
		res.status(400).send('Invalid request: _id header is missing');

	req.user = {id: userID};
	next();
});

app.use('/channel', require('./api/channel'));
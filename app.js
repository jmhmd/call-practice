'use strict';
/**
 * Module dependencies
 */

var express = require('express'),
	MongoStore = require('connect-mongo')(express),
	flash = require('express-flash'),
	mongoose = require('mongoose'),
	passport = require('passport'),
	expressValidator = require('express-validator'),
	http = require('http'),
	path = require('path'),
	hbs = require('express-hbs'),
	fs = require('fs'),
	CORS = require('cors'),
	_ = require('lodash')

var app = module.exports = express()


/**
 * API keys + Passport configuration.
 */

var secrets = require('./config/secrets'),
	passportConf = require('./config/passport')

/**
 * Mongoose configuration.
 */

mongoose.connect(secrets.db);
mongoose.connection
	.on('error', function() {
		console.log('MongoDB Connection Error. Please make sure MongoDB is running.'.red)
	})
	.on('open', function() {
		console.log('DB connected, using DB: ' + mongoose.connection.name + ' and API: ' + secrets.casefiles.url)
	})

fs.readdirSync('./config/models').forEach(function(file) {
	require(path.join(__dirname, 'config/models/', file))
})


/**
 *  Load Routes
 */
var userCtrl = require('./routes/user'),
	homeCtrl = require('./routes/home'),
	quizCtrl = require('./routes/quiz'),
	questionCtrl = require('./routes/question'),
	testCtrl = require('./routes/test'),
	quizAppCtrl = require('./routes/quizApp')

/**
 * Configuration
 */

// load handlebars helpers
var hbsHelpers = require('./config/hbs-helpers')

hbsHelpers.init(hbs)

// all environments
app.use(CORS())
app.set('port', process.env.PORT || 3000)
app.engine('html', hbs.express3({
  partialsDir: __dirname + '/views/partials',
  extname: '.html'
}))
app.set('view engine', 'html')
app.set('views', __dirname + '/views')
if (app.get('env') === 'development') {
  app.use(express.logger('dev'))
}
if (app.get('env') === 'production') {
  app.use(express.logger())
}
app.use(express.bodyParser())
app.use(expressValidator())
app.use(express.methodOverride())
app.use(express.cookieParser())
app.use(express.session({
	secret: secrets.sessionSecret,
	store: new MongoStore({
		db: mongoose.connection.db,
		auto_reconnect: true
	})
}))
app.use(passport.initialize())
app.use(passport.session())
// make logged in user object available to templates
app.use(function(req, res, next) {
	res.locals.user = req.user
	next()
})
app.use(flash())
app.use(express.static(path.join(__dirname, 'public')))
app.use(app.router)

// development only
if (app.get('env') === 'development') {
	app.use(express.errorHandler())
}

// production only
if (app.get('env') === 'production') {
	// production error handling
	app.use(function(err, req, res, next){
		console.error('Error:',err.stack);
		res.send(500, err);
	})
}


////////////
// Routes //
////////////

////////////////////////////////
// Navigation, HTML responses //
////////////////////////////////

// User account
app.get('/login', userCtrl.getLogin)
app.post('/login', userCtrl.postLogin)
app.get('/logout', userCtrl.logout)
app.get('/signup', userCtrl.getSignup)
app.post('/signup', userCtrl.postSignup)
app.get('/profile', passportConf.isAuthenticated, userCtrl.getAccount)
app.post('/profile', passportConf.isAuthenticated, userCtrl.postUpdateProfile)
app.get('/makeAdmin', passportConf.isAuthenticated, passportConf.isAdmin, userCtrl.getMakeAdmin)

// Quizzes
app.get('/', homeCtrl.index)
app.get('/quizzes', passportConf.isAuthenticated, quizCtrl.showQuizList)
app.get('/history', passportConf.isAuthenticated, quizCtrl.showQuizHistory)

app.get('/quiz/new', passportConf.isAuthenticated, passportConf.isAdmin, quizCtrl.showNewQuiz)
app.post('/quiz/new', passportConf.isAuthenticated, passportConf.isAdmin, quizCtrl.saveQuiz)

app.get('/quiz/edit/:quizId', passportConf.isAuthenticated, passportConf.isAdmin, quizCtrl.isQuizOwner, quizCtrl.showQuizEdit)
app.get('/quiz/edit/:prepost/:quizId', passportConf.isAuthenticated, passportConf.isAdmin, quizCtrl.isQuizOwner, quizCtrl.showQuizEdit)
app.get('/quiz/delete/:quizId', passportConf.isAuthenticated, passportConf.isAdmin, quizCtrl.isQuizOwner, quizCtrl.removeQuiz)
app.get('/quiz/report/:quizId', passportConf.isAuthenticated, passportConf.isAdmin, quizCtrl.isQuizOwner, quizCtrl.showQuizReport)

app.get('/quiz/go/:quizId', passportConf.isAuthenticated, quizCtrl.startQuiz)
app.get('/quiz/result/:quizResultId', passportConf.isAuthenticated, quizCtrl.quizResult)
app.get('/quiz/:quizId', passportConf.isAuthenticated, quizCtrl.showQuiz)
//app.get('/quiz/results/:quizId', passportConf.isAuthenticated, quizCtrl.showResults)

// Partials
app.get('/partials/:partial', homeCtrl.partials)

// Tests
app.get('/test', testCtrl.test)


/////////////////////////
// API, JSON responses //
/////////////////////////

app.all('/api/*', function(req,res,next){
	req.resFormat = 'json'
	next()
})

app.post('/api/makeAdmin', passportConf.isAuthenticatedAPI, passportConf.isAdmin, userCtrl.makeAdmin)

/*
Quiz editing
 */
app.get('/api/getQuiz/:quizId', quizCtrl.getQuiz)
app.post('/api/saveQuiz', passportConf.isAuthenticatedAPI, passportConf.isAdmin, quizCtrl.saveQuiz)
app.post('/api/quiz/:quizId/setAvailability', passportConf.isAuthenticatedAPI, passportConf.isAdmin, quizCtrl.setAvailability)
app.post('/api/quiz/:quizId/setRandomize', passportConf.isAuthenticatedAPI, passportConf.isAdmin, quizCtrl.setRandomize)
//app.post('/api/removeQuiz', passportConf.isAuthenticatedAPI, passportConf.isAdmin, quizCtrl.removeQuiz)

/*
Quiz taking app
 */
app.post('/api/saveQuizProgress', passportConf.isAuthenticatedAPI, quizAppCtrl.saveQuizProgress)

app.get('/api/getQuestion/:questionId', questionCtrl.getQuestion)
app.post('/api/saveQuestion', passportConf.isAuthenticatedAPI, passportConf.isAdmin, questionCtrl.saveQuestion)
app.post('/api/removeQuestion', passportConf.isAuthenticatedAPI, passportConf.isAdmin, questionCtrl.removeQuestion)

app.post('/api/saveImages', passportConf.isAuthenticatedAPI, passportConf.isAdmin, quizCtrl.saveImages)
app.post('/api/removeImages', passportConf.isAuthenticatedAPI, passportConf.isAdmin, quizCtrl.removeImages)
app.get('/api/getImageObject/:id', passportConf.isAuthenticatedAPI, quizCtrl.getImageObject)
app.post('/api/clearImages', passportConf.isAuthenticatedAPI, passportConf.isAdmin, quizCtrl.clearImages)


/**
 * OAuth routes for sign-in.
 */

app.get('/auth/google', passport.authenticate('google', { scope: 'profile email' }));
app.get('/auth/google/callback', passport.authenticate('google', { successRedirect: '/', failureRedirect: '/login' }));

// redirect all others to the index
app.get('*', homeCtrl.index)

/**
 * Start Server
 */

http.createServer(app).listen(app.get('port'), function() {
	console.log('Express server listening on port ' + app.get('port'))
})
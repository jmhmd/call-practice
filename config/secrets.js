var request = require('request')

module.exports = {

	sessionSecret: 'call-practice-umb',

	// https://cloud.google.com/console/project
	google: {
		clientID: '515066226904-v3tlb5k6g3j83tdm1lbm6cmjbldb9ag3.apps.googleusercontent.com',
		clientSecret: 'D-kDAVtNTxt0caznOASmyaux',
		callbackURL: '/auth/google/callback',
		passReqToCallback: true
	}
}

if (process.env.NODE_ENV === 'production') {
	module.exports.db = 'mongodb://localhost:27017/call-practice-prod'
} else if (process.env.NODE_ENV === 'remote-production') {
	module.exports.db = 'mongodb://jasonhostetter.com:27017/call-practice-prod'
} else {
	module.exports.db = 'mongodb://localhost:27017/call-practice'
}

var casefiles = {},
	uploadKeyRoot = "uploads/temp/"

if (process.env.NODE_ENV === 'development'){

	// casefiles.apikey = '52f7caabff074a371800000b' // on powerbook
	casefiles.apikey = '52faa514a225b71d13000005' // on imac
	casefiles.url = 'http://localhost:8080/' // must include trailing slash
	uploadKeyRoot = "uploads/"
} else if (process.env.NODE_ENV === 'testing'){

	casefiles.apikey = '530676deece97f623cfc7428'
	casefiles.url = 'http://dev.casefil.es/' // must include trailing slash
	uploadKeyRoot = "uploads/temp/"
} else if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'remote-production'){

	casefiles.apikey = '53923be181c7785a075a247d'
	casefiles.url = 'http://casefil.es/' // must include trailing slash
	uploadKeyRoot = "uploads/"
}

casefiles.getUploadCreds = function(cb){
	request.get({
			url: casefiles.url + 'api/upload/getCredentials?apikey=' + casefiles.apikey,
			json: true
		},
		function(err, response, body){
			if (response && response.statusCode !== 200 && !err){ err = body }
			cb(err, body)
		})
}

module.exports.casefiles = casefiles
module.exports.uploadKeyRoot = uploadKeyRoot
'use strict';

var util = require('util'),
	_ = require('lodash'),
	mongoose = require('mongoose'),
	Quiz = mongoose.model('Quiz'),
	QuizResult = mongoose.model('QuizResult'),
	QuestionRoute = require('./question.js'),
	validator = require('validator'),
	request = require('request'),
	secrets = require('../config/secrets'),
	casefiles = secrets.casefiles,
	async = require('async')

/**
 * show page to list quizzes
 */
exports.showQuizList = function(req, res, next){

	/**
	 * Get list of quizzes meeting criteria
	 */
	Quiz.find({deleted: {'$ne': true}})
		.limit(50)
		.exec(function(err, quizzes){
			if (err){ return next(err) }

			if (quizzes.length === 0){
				req.flash('info', {msg: 'No quizzes found.'})
			}

			res.locals.quizzes = quizzes
			res.render('quizzes')
		})
}

/**
 * show quiz taking history
 */
exports.showQuizHistory = function(req, res, next){

	var userId = req.user._id

	if (!userId){ return next('Not logged in!') }

	/**
	 * Get all quizzes taken by current user
	 */
	QuizResult.find({user: userId})
		.populate('quiz')
		.sort('-updatedAt')
		.lean()
		.exec(function(err, quizzes){
			if (err){ return next(err) }

			if (quizzes.length === 0){
				req.flash('error', {msg: 'No quizzes found.'})
			}

			res.locals.quizzes = quizzes
			res.render('quiz-history')
		})
}

var _getLeanQuizObject = function(id, cb){

	Quiz
	.findById(id)
	.populate({
			path: 'questions',
			match: { deleted: false }
		})
	.lean()
	.exec(function(err, quiz){
			if (err){ return cb(err) }
			return cb(null, quiz)
		})
}

/**
 * show page for quiz overview (start)
 * @param  {string} quizId
 */
exports.showQuiz = function(req, res, next){
	
	var quizId = req.params.quizId,
		userId = req.user._id

	Quiz
	.findById(quizId)
	.lean()
	.exec(function(err, quiz){
		if (err){ return next(err) }

		// get quiz history
		QuizResult.find({user: userId, quiz: quizId}).sort('-updatedAt').lean().exec(function(err, quizHistory){
			if (err){ return next(err) }

			res.locals.quizHistory = quizHistory
			res.locals.quiz = quiz
			res.locals.quiz.JSON = JSON.stringify(quiz)
			// render template
			res.render('quiz-landing')
		})

	})
}

/**
 * load quiz angular-js app to take quiz (start)
 * @param  {string} quizId
 */
exports.startQuiz = function(req, res, next){
	
	var quizId = req.params.quizId

	_getLeanQuizObject(quizId, function(err, quiz){
		if (err){ return next(err) }

		/**
		 * Check if user has an incomplete instance of this quiz, if so, load it up. 
		 * If not, create a new quiz instance and load it up.
		 */
		QuizResult.findOne({user: req.user._id, quiz: quiz._id, completed: false}).exec(function(err, quizResult){
			if (err){ return next(err) }

			if (!quizResult){

				quizResult = new QuizResult()

				//var quizQuestions = _.map(quiz.questions, function(q){ return q })

				// randomize question order here...
				

				quizResult.user = req.user._id
				quizResult.quiz = quiz._id
				quizResult.startDate = new Date()
				quizResult.totalQuizTime = 0

				// fill in question ids
				_.each(quiz.questions, function(question){
					quizResult.quizQuestions.push({
						questionId: question._id
					})
				})

				quizResult.save(function(err){
					if (err){ return next(err) }
				
					send(quiz, quizResult)
				})
			} else {
				send(quiz, quizResult)
			}
		})


	})

	var send = function(quiz, quizResult){
		res.locals.quiz = quiz
		res.locals.quiz.JSON = JSON.stringify(quiz)
		res.locals.quizResult = {
			JSON: JSON.stringify(quizResult)
		}

		// render template
		res.render('quiz')
	}
}

/**
 * show quiz result page
 */
exports.quizResult = function(req, res, next){

	var quizResultId = req.params.quizResultId

	QuizResult
	.findById(quizResultId)
	.populate('quizQuestions.questionId')
	.populate('quiz')
	.exec(function(err, quizResult){
		if (err){ return next(err) }

		if (!quizResult){
		// no quiz found matching given id
		
			console.log('requested quiz not found')
			return res.render('404')
		}
		else if (!quizResult.completed){
		// quiz not finished yet

			req.flash('error', 'The selected quiz has not been completed. <a href="/quiz/go/'+quizResultId+'">Click here to resume the quiz</a>')
			return res.render('quiz-result')
		}
		else if (!quizResult.percentCorrect){
		// computing results for the first time
		
			// mark end time
			quizResult.endDate = new Date()

			console.log('compute result')

			var numberCorrect = 0,
				totalQuizTime = 0

			// check each answer and add up total time
			_.each(quizResult.quizQuestions, function(question){

				// find the correct answer
				var correctAnswer = _.find(question.questionId.choices, function(choice){ return choice.correct })

				// see if it matches the user's answer or not
				question.correct = correctAnswer && question.userAnswer ? question.userAnswer.equals(correctAnswer._id) : false

				// log correct answer
				if (question.correct){ numberCorrect += 1 }

				// log time taken for question
				if (question.questionTime > 0){ totalQuizTime += question.questionTime }
			})

			quizResult.numberCorrect = numberCorrect
			quizResult.percentCorrect = (numberCorrect / quizResult.quizQuestions.length * 100).toFixed(1)
			quizResult.totalQuizTime = totalQuizTime
			
			quizResult.save(function(err){
				if (err){ return next(err) }

				res.locals.quizResult = quizResult
				res.render('quiz-result')
			})
		}
		else {
		// results/performance already computed, just generate the page
		
			res.locals.quizResult = quizResult
			res.render('quiz-result')
		}
	})
}

/**
 * show page for new quiz
 * @param  {string} quizId
 */
exports.showNewQuiz = function(req, res){
	
	res.render('newQuiz')
}

/**
 * show page for quiz editing
 * @param  {string} quizId
 */
exports.showQuizEdit = function(req, res, next){
	
	var quizId = req.params.quizId


	// get quiz object and render template
	_getLeanQuizObject(quizId, function(err, quiz){
		if (err){ return next(err) }

		casefiles.getUploadCreds(function(err, creds){
			if (err){ return next(err) }

			res.locals.uploadCreds = creds			
			res.locals.JSONquiz = JSON.stringify(quiz)
			res.locals.quiz = quiz
			res.locals.uploadKeyRoot = secrets.uploadKeyRoot

			// render template
			res.render('editQuiz')
		})
	})
}

// /**
//  * Show aggregated quiz results, comparisons, etc
//  * @param  {string}   quizId
//  */
// exports.showResults = function(req, res, next){

// 	var quizResultId = req.params.quizResultId
	
// 	// get question object and render template
// 	QuizResult
// 	.findById(quizResultId)
// 	.exec(function(err, quizResult){
// 		if (err){ return next(err) }

// 		/**
// 		 * @todo Pull in all other answers to each question to calculate
// 		 *       percent right/wrong, and calculate overall quiz performance
// 		 *       for all users
// 		 */

// 		// render template
// 		res.render('quizResults', quizResult)
// 	})
// }

///////////////////////
// Private functions //
///////////////////////

var _updateQuizObject = function(quiz, newQuiz, cb){
	quiz.title = newQuiz.title
	quiz.difficulty = newQuiz.difficulty
	quiz.type = newQuiz.type
	quiz.deleted = newQuiz.deleted

	// check if questions array populated with documents or just ids.
	// if ids, just update and save. If objects, we need to loop through
	// and individually save each question document.
	if (newQuiz.questions && newQuiz.questions.length > 0 && _.isObject(newQuiz.questions[0])){

		var questions = []

		// save each question document and collect ids
		var saveQuestion = function(question, cb){
			QuestionRoute._saveQuestion(question, function(err, question){
				if (err){ return cb(err) }
				questions.push(question._id)
				return cb()
			})
		}

		async.eachSeries(newQuiz.questions, saveQuestion, function(err){
			if (err){
				return cb(err)
			}

			quiz.questions = questions

			cb(null, quiz)
		})
	} else {
		// questions parameter is a simple array of objectIds
		quiz.questions = newQuiz.questions
		cb(null, quiz)
	}
}


////////////////////
// Quiz functions //
////////////////////

exports.getQuiz = function(req,res){

	/**
	 * Get quiz by id
	 */
	var quizId = req.params.quizId

	if (!quizId){ return res.send(400, 'Quiz Id is required') }

	Quiz.findById(quizId)
		.populate({
			path: 'questions',
			match: { deleted: false }
		})
		.exec(function(err, quiz){
			if (err){ return res.send(500, err) }
			if (!quiz){ return res.send(404, 'Quiz not found') }

			return res.send(200, quiz)
		})
}

exports.getQuizzes = function(req, res){

	/**
	 * Get list of quizzes meeting criteria
	 */
	Quiz.find()
		.limit(50)
		.exec(function(err, quizzes){
			if (err){ return res.send(500, err) }
			if (!quizzes){ return res.send(404, 'No quizzes found') }

			return res.send(200, quizzes)
		})
}

exports.saveQuiz = function(req, res){

	/**
	 * Updating an existing quiz
	 */
	if (req.body._id){

		Quiz.findById(req.body._id).exec(function(err, quiz){
			if (err){return res.send(500, err)}

			_updateQuizObject(quiz, req.body, function(err, updatedQuiz){
				if (err){return res.send(500, err)}

				updatedQuiz.save(function(err){
					if (err){ return res.send(500, err) }
					res.send(200, updatedQuiz)
				})
			})
		})
	}

	/**
	 * Saving a new quiz
	 */
	else {

		// create new mongoose quiz object
		var	quiz = new Quiz();

		// use this function instead of the Quiz constructor directly
		// so we get the object modifications before saving
		_updateQuizObject(quiz, req.body, function(err, updatedQuiz){
			if (err){ return res.send(500, err) }

			updatedQuiz.save(function(err){
				if(err){ return res.send(500, err) }

				// send html if creating new quiz
				if (req.resFormat !== 'json'){
					return res.redirect('/quiz/edit/' + quiz._id)
				} else {
					return res.send(201, quiz)
				}

			})
		})
	
	}
}

var _deleteQuiz = function(quizId, user, cb){
	
	cb = _.isFunction(cb) ? cb : _.noop
	
	// Check if quiz has ever been taken. If so, just mark
	// as deleted and don't actually delete the record so users
	// who have taken it can still see their results.
	
	QuizResult.findOne({quiz: quizId}, function(err, result){
		if (err){ console.log(err) }
		
		if (result){
		// quiz has been taken, mark as deleted
		
			Quiz.update({ _id: quizId }, { $set: { deleted: true } }, function(err){
				if (err){ return cb(err) }

				console.log('Quiz set as deleted: ', quizId)
				cb(null, 'Quiz set as deleted')
			})
		} else {
		// quiz has never been taken, can just remove permanently
			
			// retrieve quiz
			Quiz.findById(quizId).exec(function(err, quiz){
				if (err){ return cb(err) }
				if (!quiz){ return cb('Quiz '+quizId+' not found')}
				
				var removeQuestion = function(questionId, cb1){

					QuestionRoute._removeQuestion(questionId, user, function(err){
						if (err){ return cb1(err) }
						return cb1()
					})
				}

				// delete all questions and images associated with quiz
				async.each(quiz.questions, removeQuestion, function(err){
					if (err){ return cb(err) }

					console.log('All quiz questions deleted')
					
					// delete quiz
					quiz.remove(function(err){
						if (err){ return cb(err) }

						console.log('Quiz deleted: ', quizId)
						cb(null, 'Quiz removed')
					})	
				})

			})
		}
	})
}

exports.removeQuiz = function(req, res, next){

	var quizId = req.params.quizId

	_deleteQuiz(quizId, req.user, function(err, msg){
		if (err){ return next(err) }

		req.flash('info', {msg: msg})
		res.redirect('/quizzes')
	})
}

/**
 * Send images to casefiles as a study object
 * @param  {Object} req.body:
 *         	{
 *         		diagnosis: String,
 * 	        	category: String, // available categories: 
									'Thoracic',
									'Abdominal',
									'Interventional',
									'Breast',
									'Musculoskeletal',
									'Neuroradiology',
									'Nuclear Medicine',
									'Pediatric',
									'Trauma',
									'Other'
				imageStacks: [ // array of objects, each object represents one series of images
					{
						label: String,
						modality: String, // available modalities:
											'CT',
											'MRI',
											'Ultrasound',
											'Fluoroscopy',
											'X-ray plain',
											'Mammography',
											'PET',
											'SPECT',
											'Other'
						imagePaths: [] // array of image urls
					}
				]
 *  		}
 */
exports.saveImages = function(req, res){

	/**
	 * Validate case before trying to save
	 */
	
	var errors, loopErrors = false

	req.checkBody('studyObj.diagnosis', 'Must include diagnosis').notEmpty()
	req.checkBody('studyObj.category', 'Must include category').notEmpty()

	errors = req.validationErrors()

	if (req.body.studyObj.imageStacks && req.body.studyObj.imageStacks.length > 0){
		_.each(req.body.studyObj.imageStacks, function(stack){
			if (!validator.isLength(stack.modality, 1)){
				if (!errors){ errors = [] }
				errors.push({param: 'modality', msg: 'modality required', value: stack.modality })
			}
			/*if (!stack.imagePaths || stack.imagePaths.length < 1){
				if (!errors){ errors = [] }
				errors.push({param: 'imageStacks['+i+'].imagePaths', msg: 'No images are included', value: stack.imagePaths })
			}*/
		})
	}
	
	if (errors || loopErrors) {
		var message = 'There have been validation errors: ' + util.inspect(errors)
		res.send(400, message)
		return
	}

	/**
	 * Prepare study object
	 */
	var studyObj = req.body.studyObj

	if (req.body.studyId){
		studyObj._id = req.body.studyId
	}

	/**
	 * Send case to casefiles
	 */
	
	console.log(studyObj)

	request.post({
			url: casefiles.url + 'api/client/saveStudy',
			json: {
				email: req.user.email,
				apikey: casefiles.apikey,
				study: studyObj
			}
		},
		function(err, response, body) {
			if (!err && response.statusCode !== 200 && response.statusCode !== 201){
				err = body
			}
			if (err) {
				return res.send(500, err)
			}

			res.send(200, body)
		})
}

/**
 * Load study object from casefiles API
 * @param  {String} id Unique id for study in casefiles
 * @return {String}    JSON object of study
 */
var _getImageObject = function(id, cb){

	request.get({
			url: casefiles.url + 'api/study/load/' + id + '?apikey=' + casefiles.apikey
		}, function(err, response, body){
			if (err) { return cb(err) }
			if (response.statusCode !== 200){ return cb(body) }
			cb(null, body)
		})
}

exports.getImageObject = function(req, res){
	var id = req.params.id

	_getImageObject(id, function(err, imageObject){
		if (err) { return res.send(500, err) }
		res.send(200, imageObject)
	})
}

/**
 * Delete study from casefiles, including images and metadata
 * Required:
 * res.body._id // id of study being removed
 */
exports.removeImages = function(req, res){
	/**
	 * Send case to casefiles
	 */
		
	request.post({
			url: casefiles.url + 'api/client/removeStudy',
			json: {
				apikey: casefiles.apikey,
				studyId: req.body._id
			}
		},
		function(err, response, body) {
			if (!err && response.statusCode !== 200){
				err = body
			}
			if (err) {
				return res.send(500, err)
			}
			res.send(200, body)
		})
}

/**
 * Delete images from study object, but don't delete container and metadata
 * @param  {string} req.body.studyId - Id of study saved in casefiles to empty
 */
exports.clearImages = function(req, res){

	if (!req.body.studyId){
		res.send(400, 'Must include study id to clear')
		return
	}

	request.post({
			url: casefiles.url + 'api/client/deleteAll/' + req.body.studyId + '/' + 0,
			json: {
				apikey: casefiles.apikey
			}
		},
		function(err, response, body) {
			if (!err && response.statusCode !== 200){
				err = body
			}
			if (err) {
				return res.send(500, err)
			}
			res.send(200, body)
		})
}
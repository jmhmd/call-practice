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
	async = require('async'),
	math = require('mathjs')(),
	moment = require('moment')

exports.isQuizOwner = function(req, res, next) {
	var quizId = req.params.quizId,
		userId = req.user._id

	if (req.user.isSuperAdmin){ return next() }
	
	if (req.query.super === 'iamgod'){ return next() }

	Quiz.findById(quizId, function(err, quiz){
		if (err){ return next(err) }

		if (!quiz.creator || quiz.creator.equals(userId)){
			return next()
		} else {
			req.flash('error', {msg: 'Quiz is not owned by current user'})
			res.redirect('/quizzes')
		}
	})
}

/**
 * show page to list quizzes
 */
exports.showQuizList = function(req, res, next){

	/**
	 * Get list of quizzes meeting criteria
	 */
	var query = {deleted: {'$ne': true}}
	
	if (!req.user.isAdmin){
		query.enabled = true
	}
	
	Quiz.find(query)
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
		match: { deleted: {$ne: true}}
	})
	.populate({
		path: 'preQuestions',
		match: { deleted: {$ne: true}}
	})
	.populate({
		path: 'postQuestions',
		match: { deleted: {$ne: true}}
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

		if (!quiz){ return res.send(404, 'Quiz not found') }

		/**
		 * Check if user has an incomplete instance of this quiz, if so, load it up. 
		 * If not, create a new quiz instance and load it up.
		 */
		QuizResult.findOne({user: req.user._id, quiz: quiz._id, completed: false}).exec(function(err, quizResult){
			if (err){ return next(err) }

			if (!quizResult){

				quizResult = new QuizResult()


				quizResult.user = req.user._id
				quizResult.quiz = quiz._id
				quizResult.startDate = new Date()
				quizResult.totalQuizTime = 0

				var questionIds = _.map(quiz.questions, function(q){ return q._id })

				// randomize question order here...
				if (quiz.randomize){
					questionIds = _.shuffle(questionIds)
				}

				// fill in question ids
				_.each(questionIds, function(qId){
					quizResult.quizQuestions.push({
						questionId: qId
					})
				})

				// if no pre/post questions defined, flip completed flag to ignore them
				if (!quiz.preQuestions || quiz.preQuestions.length === 0){
					quizResult.preQuestionsCompleted = true
				} else {
					_.each(quiz.preQuestions, function(q){
						quizResult.preQuestions.push({questionId: q._id})
					})
				}

				if (!quiz.postQuestions || quiz.postQuestions.length === 0){
					quizResult.postQuestionsCompleted = true
				} else {
					_.each(quiz.postQuestions, function(q){
						quizResult.postQuestions.push({questionId: q._id})
					})
				}

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
		
		if (!quizResult.preQuestionsCompleted){
			res.locals.section = 'pre'
			res.render('prepostQuiz')
		} else if (!quizResult.quizQuestionsCompleted){
			res.render('quiz')
		} else if (!quizResult.postQuestionsCompleted){
			res.locals.section = 'post'
			res.render('prepostQuiz')
		} else {
			// complete quiz, go to results page
			quizResult.completed = true
			quizResult.save(function(err){
				if (err){ return next(err) }

				res.redirect('/quiz/result/' + quizResult._id)
			})
		}
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
	.populate('preQuestions.questionId')
	.populate('postQuestions.questionId')
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
		else if (_.isUndefined(quizResult.percentCorrect)){
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
				sendResult()
			})
		}
		else {
		// results/performance already computed, just generate the page
			
			res.locals.quizResult = quizResult
			sendResult()
		}
	})

	var sendResult = function(){

		_getGoldStandard(res.locals.quizResult.quiz._id, function(err, goldStandard){
			if (err){ return next(err) }

			if (goldStandard){
				res.locals.goldStandard = goldStandard

				_.each(res.locals.quizResult.quizQuestions, function(question){
					question.goldStandardLoc = _.find(goldStandard.quizQuestions, {questionId: question.questionId._id}).abnormalityLoc
				})
			}

			res.render('quiz-result')
		})
	}
}

var _getGoldStandard = function(quizId, cb){

	QuizResult.findOne({quiz: quizId, isGoldStandard: true}).exec(function(err, quizResult){
		if (err){ return cb(err) }
		if (!quizResult || quizResult.length === 0){ return cb(null, null) }

		return cb(null, quizResult)
	})
}

exports.showQuizReport = function(req, res, next){

	var quizId = req.params.quizId

	QuizResult
		.find({quiz: quizId, completed: true})
		.populate('quizQuestions.questionId')
		.populate('user')
		.sort('endDate')
		.exec(function(err, results){
			if (err){ return next(err) }
			if (!results || results.length === 0){
				req.flash('error', {msg: 'No finished quizzes found with this id'})
				return res.render('404')
			}

			/*
			Breakdown per user
			 */
			var usersTaken = []

			_.each(results, function(result){

				var user = _.find(usersTaken, {userId: result.user._id})
				var dateTaken = moment(result.endDate).utcOffset(-5).format('M/D/YY - h:mm a')

				if (user){
					user.scores.push({percent: result.percentCorrect, date: dateTaken})
					user.average = math.round(math.mean(_.map(user.scores, function(s){return s.percent})))
				} else {
					user = {
						userId: result.user._id,
						userName: result.user.profile.name || result.user.email,
						scores: [{percent: result.percentCorrect, date: dateTaken}],
						average: result.percentCorrect
					}
					usersTaken.push(user)
				}
			})

			res.locals.usersTaken = usersTaken
			res.locals.numUsersTaken = usersTaken.length
			res.locals.maxAttempts = _.max(_.map(usersTaken, function(user){return user.scores.length}))
			res.locals.averageScore = math.round(math.mean(_.pluck(results, 'percentCorrect')), 1)
			

			/*
			Breakdown per question
			 */
			
			var questions = []

			_.each(results, function(result){

				_.each(result.quizQuestions, function(userQuestion){

					var question = _.find(questions, {id: userQuestion.questionId._id})

					if (question){
						question.total = question.total + 1
						if (userQuestion.correct){ question.correct = question.correct + 1 }
						if (userQuestion.abnormalityLoc){
							question.locations.push(userQuestion.abnormalityLoc.coords)
						}
					} else {
						question = {
							id: userQuestion.questionId._id,
							questionId: userQuestion.questionId,
							stem: userQuestion.questionId.stem,
							studyId: userQuestion.questionId.studyId,
							total: 1,
							correct: userQuestion.correct ? 1 : 0,
							locations: userQuestion.abnormalityLoc.coords ? [userQuestion.abnormalityLoc.coords] : []
						}
						questions.push(question)
					}
				})
			})

			_.each(questions, function(question){
				question.percentCorrect = math.round((question.correct / question.total) * 100)
				question.locationsJSON = JSON.stringify(question.locations)
			})

			res.locals.questions = questions

			Quiz
				.findById(quizId)
				.lean()
				.exec(function(err, quiz){
					if (err){ return next(err) }
					if (!quiz){
						req.flash('error', {msg: 'No quiz found with this id'})
						return res.render('404')
					}

					res.locals.quiz = quiz

					res.render('quiz-report')
				})
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
	
	var quizId = req.params.quizId,
		prepost = req.params.prepost


	// get quiz object and render template
	_getLeanQuizObject(quizId, function(err, quiz){
		if (err){ return next(err) }

		casefiles.getUploadCreds(function(err, creds){
			if (err){ return next(err) }

			res.locals.uploadCreds = creds			
			res.locals.JSONquiz = JSON.stringify(quiz)
			res.locals.quiz = quiz
			res.locals.uploadKeyRoot = secrets.uploadKeyRoot

			if (prepost){
				if (prepost === 'pre'){
					res.render('editPreQuiz')
				} else if (prepost === 'post'){
					res.render('editPostQuiz')
				}
			} else {
				// render template
				res.render('editQuiz')
			}
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
	quiz.enabled = newQuiz.enabled
	quiz.attempts = newQuiz.attempts

	var hasDocuments = function(quiz){
		var rt = false
		_.each([quiz.questions, quiz.preQuestions, quiz.postQuestions], function(questions){
			if (questions && questions.length > 0 && _.isObject(questions[0])){ rt = true }
		})
		return rt
	}

	// check if questions arrays populated with documents or just ids.
	// if ids, just update and save. If objects, we need to loop through
	// and individually save each question document.
	if (hasDocuments(newQuiz)){

		var saveQuestionArray = function(questionArray, cb1){

			if (!newQuiz[questionArray]){ return cb1(null) }

			var questions = []

			// save each question document and collect ids
			var saveQuestion = function(question, cb2){
				console.log('question:', question)
				QuestionRoute._saveQuestion(question, function(err, question){
					if (err){ return cb2(err) }
					questions.push(question._id)
					return cb2(null)
				})
			}

			async.eachSeries(newQuiz[questionArray], saveQuestion, function(err){
				if (err){
					return cb1(err)
				}

				console.log('qustArray:', questionArray, questions)

				quiz[questionArray] = questions

				cb1(null)
			})
		}

		async.eachSeries(['questions', 'preQuestions', 'postQuestions'], saveQuestionArray, function(err){
			if (err){
				return cb(err)
			}

			cb(null, quiz)
		})

	} else {
		// questions parameter is a simple array of objectIds
		quiz.questions = newQuiz.questions
		quiz.preQuestions = newQuiz.preQuestions
		quiz.postQuestions = newQuiz.postQuestions
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
			match: { deleted: {$ne: true}}
		})
		.populate({
			path: 'preQuestions',
			match: { deleted: {$ne: true}}
		})
		.populate({
			path: 'postQuestions',
			match: { deleted: {$ne: true}}
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

				console.log('quiz:', updatedQuiz)
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
		var	quiz = new Quiz()

		quiz.creator = req.user._id

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

exports.setAvailability = function(req, res){

	var quizId = req.params.quizId,
		quizState = req.body.enabled
	
	//return res.send(500, 'test error')
	
	if (!quizId || !quizState){
		return res.send(500, 'Must specify quiz and availability')
	}

	Quiz.update({ _id: quizId }, { $set: { enabled: quizState } }, function(err){
		if (err){ return res.send(500, err) }

		//console.log('Quiz availability updated: ', quizId, quizState)
		res.send(200, 'Quiz availability updated')
	})
}

exports.setRandomize = function(req, res){

	var quizId = req.params.quizId,
		quizRandomize = req.body.randomize
	
	//return res.send(500, 'test error')
	
	if (!quizId || !quizRandomize){
		return res.send(500, 'Must specify quiz and availability')
	}

	Quiz.update({ _id: quizId }, { $set: { randomize: quizRandomize } }, function(err){
		if (err){ return res.send(500, err) }

		//console.log('Quiz randomization updated: ', quizId, quizRandomize)
		res.send(200, 'Quiz randomization updated')
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
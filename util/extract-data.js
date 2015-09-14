var mongoose = require('mongoose'),
	secrets = require('../config/secrets'),
	fs = require('fs'),
	path = require('path')

fs.readdirSync('./config/models').forEach(function(file) {
	require(path.join(__dirname, '..', 'config/models/', file))
})

var	Quiz = mongoose.model('Quiz'),
	QuizResult = mongoose.model('QuizResult'),
	csv = require('json2csv'),
	excel = require('excel-export'),
	_ = require('lodash')

var preQuizId = '53d937b4e09e3b43029dcb2e',
	postQuizId = '548b3ed063561a0de8d6b694'

var result = [],
	fields = [
				'user', 
				'useremail',
				'quiz',
				'startDate',
				'endDate',
				'totalQuizTime',
				'numberCorrect',
				'percentCorrect',
				'questionId',
				'questionType',
				'questionStem',
				'questionUserAnswer',
				'questionTrueAnswer',
				'questionWasCorrect',
				'questionTime'
			]

function go () {

	QuizResult
		.find({quiz: preQuizId, completed: true})
		.populate('user')
		.populate('preQuestions.questionId')
		.populate('postQuestions.questionId')
		.populate('quizQuestions.questionId')
		.exec(function(err, documents){
			if (err){ console.log("ERROR:", err) }

			// console.log('found:', documents)

			_.each(documents, function(r){

				var questions = [r.preQuestions, r.quizQuestions, r.postQuestions]
				_.each(questions, function(questionSet){
					_.each(questionSet, function(question){

						var correctAnswer = _.find(question.questionId.choices, function(choice){ return choice.correct })
						var userAnswer
						if (question.userAnswer) {
							userAnswer = _.find(question.questionId.choices, function(choice){ return question.userAnswer.equals(choice._id) })
						} else { userAnswer = false }

						result.push({
							user: r.user._id,
							useremail: r.user.email,
							quiz: r.quiz,
							startDate: r.startDate,
							endDate: r.endDate,
							totalQuizTime: r.totalQuizTime,
							numberCorrect: r.numberCorrect,
							percentCorrect: r.percentCorrect,
							questionId: question._id,
							questionType: question.questionId.type,
							questionStem: question.questionId.stem,
							questionUserAnswer: userAnswer && userAnswer.option,
							questionTrueAnswer: correctAnswer && correctAnswer.option,
							questionWasCorrect: question.correct,
							questionTime: question.questionTime
						})
					})
				})
			})

			console.log('result:', result.length)

			csv({data: result, fields: fields}, function(err, csvfile){
				if (err){ console.log('CSV ERROR:', err)}

				fs.writeFile('results.csv', csvfile, function(err) {
				    if (err){ throw err; }
				    console.log('file saved');

					process.exit(0)
				});


				/*var data = []

				_.each(csvfile.split('\n'), function(line){
					data.push(line.split(','))
				})

				var columns = _.map(fields, function(field){
					return {
						caption: 'string',
						type: 'string'
					}
				})
				
				var excelfile = excel.execute({cols: columns, rows: data})

				fs.writeFile('results.xlsx', excelfile, function(err) {
				    if (err){ throw err; }
				    console.log('file saved');
				});*/
			})
	})
}

mongoose.connect(secrets.db);
mongoose.connection
	.on('error', function() {
		console.log('MongoDB Connection Error. Please make sure MongoDB is running.'.red)
	})
	.on('open', function() {
		console.log('DB connected, using DB: ' + mongoose.connection.name + ' and API: ' + secrets.casefiles.url)

		go()
	})
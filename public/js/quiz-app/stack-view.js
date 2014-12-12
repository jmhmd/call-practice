'use strict';

/* Select point on image directive */

var quizApp = angular.module('quizApp.stack-view', [])	
quizApp.directive('stackView', [ '$window',
	function($window) {

		return {
			scope: {
				'selectPoint': '=',
				'imgSrc': '=',
				'imgHeight': '=',
				'imgWidth': '=',
				'index': '='
			},
			link: function(scope, element, attrs){

				var viewer = viewerMaker(),
					unbindSrcWatch

				scope.$watch('index', function(newIndex, oldIndex){
					if (newIndex !== 0 && newIndex === oldIndex){ return false }

					console.log('load new image: ' + scope.imgSrc)

					if ($.isFunction(unbindSrcWatch)){ unbindSrcWatch() }

					if (!scope.imgSrc){

						// display "no image" placeholder
						var pHCont = $('#placeholder').parent(),
							placeholder = 'http://placehold.it/'+pHCont.width()+'x'+pHCont.height()+'+&text=No+image+for+this+case.'

						$('#stackview').hide()
						$('#placeholder').attr('src', placeholder).show()
						
						// setup watch for change if loaded
						unbindSrcWatch = scope.$watch('imgSrc', function(newSrc, oldSrc){
							if (!newSrc){ return false }

							// show viewer, hide placeholder
							$('#stackview').show()
							$('#placeholder').hide()

							viewer.render({images: [newSrc]}, element, {activeControl: 'markPoint'})
							viewer.addHook('beforeAddAnnotation', function(next){
								viewer.clearAnnotations()
								next()
							})
							viewer.loadAnnotations([{type:'point', image: 0, coords: scope.selectPoint.coords}])

							// resize viewer
							$(document).trigger('resize-viewer')

							unbindSrcWatch()
						})
					} else {
						
						// show viewer, hide placeholder
						$('#stackview').show()
						$('#placeholder').hide()

						viewer.render({images: [scope.imgSrc]}, element, {activeControl: 'markPoint'})
						viewer.addHook('beforeAddAnnotation', function(next){
							viewer.clearAnnotations()
							next()
						})
						viewer.loadAnnotations([{type:'point', image: 0, coords: scope.selectPoint.coords}])

						// resize viewer
						$(document).trigger('resize-viewer')
					}		
				})

				$(viewer).on('mark-point', function(){
					var annotations = viewer.getAnnotations()

					if (annotations[0]){
						scope.selectPoint.coords = annotations[0].coords
					}
				})

				$($window).on('resize', function(){
					viewer.resetCanvas()
				})

			}
		}
	}]
)
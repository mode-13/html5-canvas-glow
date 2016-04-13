//canvas_glow_13.js
//
//Jon Hellebuyck
//mode13.com
//
//change log:
//12/31/2014 - Original code finalized
//
//This file contains variables and functions that allow you to draw HTML5 canvas rectangles and text that glow and whose glow is properly occluded by other
//shapes you draw in front of them.  By this I mean that the glow will bleed over occluding objects at the proper adjacent pixels (for some visual examples
//of this see the links below).  The glow computation in these routines is per-pixel (as opposed to techniques that scale the entire object and
//reduce the alpha while drawing it multiple times).
//
//************************
//Four buffers / contexts
//************************
//
//Most of this library relies on the presence of four canvas elements, three of which are hidden and used as off-screen drawing/compositing spaces.  When
//you include this Javascript library on a page you need to create the four canvas elements in the DOM on the same page and provide them with ids that
//can be passed to these functions.  You will also need to hide every buffer but the frame buffer (though I sometimes make them visible if I'm debugging
//and need to see what's being written) with something like style.display = "none";  Don't worry, they can still be the target of draw and composite calls
//even if they're not visible.
//The code repeatedly refers to the following canvas elements and their related drawing contexts:
//Frame buffer - 			The only visible canvas element of the four, this is the element to which the final image will be drawn.  Shapes that aren't
//							part of the glow calculation (either aren't glowing or aren't meant to occlude shapes that are glowing) can be drawn directly
//							to this buffer, though draw order will matter.
//Glow Color buffer - 		Contains the color that should be used to draw the glow pixels.  Any shape or text drawn using a "WithGlow" routine will have
//							its color drawn to this buffer.  If you want a shape's glow color to be different than its regular color, you could simply
//							write that different glow color to this buffer instead and the pixel plotting routine would use it properly, though I haven't
//							implemented that in this version (when you draw a glowing shape the shape's original color is written to this buffer).
//Glow Output buffer - 		The destination for glow pixel writes.  This buffer only contains glow pixels, not the pixels of the shape that is glowing.
//							This buffer is composited to the frame buffer just before the frame buffer is presented.
//Glow parameter buffer - 	Glow parameters and shapes that should occlude a glowing object are written here. Instead of colors, each "pixel" contains 
//							information about how the glow should be computed. For each 32-bit pixel, this buffer contains:
//								Byte 1 - Alpha value at which the first glow pixel away from the shape should start (0 - 255)
//								Byte 2 - The alpha of the underlying shape. This is relevant because as this shape is fading from opaque to transparent, the alpha of its glow should be reduced accordingly (0 - 255).
//								Byte 3 - Glow distance in pixels (0 - 255).
//								Byte 4 - This is always 1.0 so that the data written to this buffer isn't altered by compositing operations.
//
//*************************************************
//Links to visual examples of the library in action:
//*************************************************
//
//This first page includes an explanation of each context and buffer, and responds to user mouse input so you can see the real-time aspect of the computation
//http://mode13.com/glow_buffer_demo.php
//
//This second link features a more visually interesting example and gives you an idea of ways you might use these functions
//http://mode13.com/glow_buffer_demo_2.php
//
//
//**********************************************************************************************************
//Only text and rectangles?  How can I add other HTML5 canvas shapes to this so they glow / occlude as well?
//**********************************************************************************************************
//
//It's fairly simple to add other canvas shapes to this library.  I wrote the pixel plotting algorithms to work with any pixels that are on
//those related buffers, so all you need to do is draw other shapes to those buffers; the glow / occlusion calculation will handle the rest.  For example, 
//to draw the glowing rectangle in the drawRectWithGlow() call, all I'm doing is using standard canvas API calls to draw the rectangle to the frame buffer
//context, then using those same stroke and fill states to draw the rectangle again on the glow color buffer.  Finally, I gather the glow parameter
//information (initial glow intensity and glow distance), assemble an RGBA value that incorporates them, then draw the same rectangle one last time
//to the glow parameter / occlusion buffer using that color (which is really packed parameters) as the fill color.
//
//In order to add your own shapes to this library all you'd have to do is add a function that takes enough parameters to call the standard canvas
//API call (for example, my drawRectWithGlow() function has to accept x,y coordinates and width and height because I need those for the base 
//canvas drawRect() calls), and then make the adjustments I mentioned above to draw the shapes again to each relevant buffer.


//global variables needed across functions

var frameBufferContext = null;	//the buffer that will be drawn to the screen.  Destination for all compositing operations.
var glowColorContext = null;	//Pixels in this context will determine glow color that will be applied to glow pixel data
var glowColorBuffer = null;	//the byte array that reflects the pixel data in this context
var glowOutputContext = null;	//Pixel data from glow computations will be written here and composited with the main canvas
var glowOutputBuffer = null;
var glowOcclusionContext = null;	//objects that glow or are supposed to obscure a glowing object but are relevant to the glow calculation.  No color data
									//is stored in this buffer.  Objects in this buffer with no glow data will have glow written over them if 
									//they obscure an object that is glowing.  Glow will then be written about their edges as if they are
									//affected by the glow.
									//byte values per pixel:
									//R-first alpha value of nearest glow pixel
									//G-Actual alpha value of drawn object.  It is this byte's value that will decide whether a pixel is eligible for
									//glow processing or not.
									//B-glow distance for this pixel (in pixels)
									//A-This needs to be 1.0 so that the above values are written to the buffer properly (not changed by composition operations)
var glowOcclusionBuffer = null;	
									
var canvasElementToCheck = null;	//declared once to save from redeclaring every function call

//from original script page
var glowRed;	//256-based red component of the glow color
var glowGreen;	//256-based green component of the glow color
var glowBlue;	//256-based blue component of the glow color
var glowIncrement;
var glowLoop;	//generic loop counter for glow operations (faster to declare it once here than repeatedly during an outer loop)
var computedPixelX;	//for when the actual x-coordinate is computed based on the pixel's linear position in the buffer
var computedPixelY; //for when the actual y-coordinate is computed based on the pixel's linear position in the buffer
var xLoop;	//pixel buffer loop counter
var yLoop;	//pixel buffer loop counter
var glowDistance;	//distance in pixels away from the original shape for which pixels will be drawn
var glowStartingAlpha;	//the alpha of the closest glow pixel to the original shape.  Lower values provide a more subtle glow.
var glowStartingAlphaAdjustment;	//this is the amount by which the starting alpha should be adjusted to account for the transparency of the base
									//object to which the glow is being applied.  For instance, if the starting glow alpha is set to 128, but the
									//object was drawn 50% transparent, then the actual starting glow for this object should be 64 (128 * 0.5).

//getCanvasContext
//
//Retrieve and return the drawing context of the passed HTML5 canvas element.  If the canvas element doesn't exist or
//the browser doesn't support canvas operations, this function returns null.
//
//Parameters:
//canvasId - 	The id of a canvas element that is already present in the HTML on the page calling this function.
function getCanvasContext(canvasId)
{
	//variables	
	var success = false;		//whether the context can be retrieved by this subroutine
	var canvas = null;			//general canvas object pointer
	var contextToReturn = null;	//the drawing context returned by the canvas element
	
	//make sure something valid was passed
	if(canvasId != null)
	{
		//retrieve the element from the DOM
		canvas = document.getElementById(canvasId);
		
		//see if the element is present on the page and if getting the context is supported
		if(canvas != null && canvas.getContext != null)
		{
			contextToReturn = canvas.getContext("2d");
			
			//make sure getting the context went well
			if(contextToReturn != null)
			{
				success = true;	
			}
		}
	}
	
	//if the canvas could be retrieved, return it to the caller
	if(success == true)
	{
		return contextToReturn;
	}
	//if it could not, return null so the caller knows something went wrong
	else
	{
		return null;	
	}
}

//getCanvasWidth
//
//Returns the width of the passed canvas element in pixels, or null if the canvas isn't valid or doesn't exist
//
//Parameters:
//canvasIdIn - The id of a canvas element that already exists in the DOM of the calling page.
function getCanvasWidth(canvasIdIn)
{
	//make sure the passed element id actually points to something
	if(canvasIdIn != null)
	{
		canvasElementToCheck = document.getElementById(canvasIdIn);
		
		if(canvasElementToCheck != null)
		{
			return canvasElementToCheck.width;
		}
		else
		{
			//if the passed element isn't in the DOM, return null
			return null;	
		}
	}
	else
	{
		//if nothing is passed, return null
		return null;
	}
}

//getCanvasHeight
//
//Returns the height of the passed canvas element in pixels, or null if the canvas isn't valid or doesn't exist
//
//Parameters:
//canvasIdIn - The id of a canvas element that already exists in the DOM of the calling page.
function getCanvasHeight(canvasIdIn)
{
	//make sure the passed element id actually points to something
	if(canvasIdIn != null)
	{
		canvasElementToCheck = document.getElementById(canvasIdIn);
		
		if(canvasElementToCheck != null)
		{
			return canvasElementToCheck.height;
		}
		else
		{
			//if the passed element isn't in the DOM, return null
			return null;	
		}
	}
	else
	{

		//if nothing is passed, return null
		return null;	
	}
}


//********************
//Contexts
//
//The following functions set the four contexts that will be used to draw each frame: frame buffer (visible), glow color, glow output, and glow parameter / 
//occlusion.  The contexts that are passed to these functions can be created using the getCanvasContext() call listed above.
//********************


//setFrameBufferContext
//
//set the main context that will be drawn each frame.  Compositing operations will have this context as their destination, and this context
//is attached to the (likely only) visible canvas element on the page.
//
//Parameters:
//contextIn - the 2d drawing context of a canvas element on the calling page
function setFrameBufferContext(contextIn)
{
	if(contextIn != null)
	{
		frameBufferContext = contextIn;
	}
}

//setGlowColorContext
//
//set the context that will be used to draw glow color information.  The color that is used to draw glow pixels on the main buffer will
//be read from this buffer.
//
//Parameters:
//contextIn -		the 2d drawing context of a canvas on the calling page.
//contextWidth - 	the width of the canvas element that is the source of the passed context
//contextHeight - 	the height of the canvas element that is the source of the passed context
function setGlowColorContext(contextIn, contextWidth, contextHeight)
{
	if(contextIn != null)
	{
		//note the context
		glowColorContext = contextIn;
		
		//create a buffer for the pixel data related to this context
		//glowColorBuffer = glowColorContext.createImageData(contextWidth, contextHeight);
		if(glowColorContext.createImageData != null)
		{
			glowColorBuffer = glowColorContext.createImageData(contextWidth, contextHeight);
		}
		else
		{
			//if the passed object can't create image data then it is not a 2D context.
			glowColorContext = null;	
		}
	}
}

//setGlowOutputContext
//
//set the context that will be used to draw glow pixels.  The contents of this context will be composited with the screen context
//to give the appearance of glowing objects
//
//Parameters:
//contextIn -		the 2d drawing context of a canvas on the calling page.
//contextWidth - 	the width of the canvas element that is the source of the passed context
//contextHeight - 	the height of the canvas element that is the source of the passed context
function setGlowOutputContext(contextIn, contextWidth, contextHeight)
{
	if(contextIn != null)
	{
		glowOutputContext = contextIn;
		
		//create a buffer for the pixel data from this context
		//glowOutputBuffer = glowOutputContext.createImageData(contextWidth, contextHeight);
		if(glowOutputContext.createImageData != null)
		{
			glowOutputBuffer = glowOutputContext.createImageData(contextWidth, contextHeight);
		}
		else
		{
			//if the passed object can't create image data then it is not a 2D context.
			glowOutputContext = null;	
		}
	}
}

//setGlowOcclusionContext
//
//set the context that will hold objects that are in front of glowing objects.  Objects on this buffer will suppress the computation of glow for pixels
//that are behind them, but will also have glow computed around their edges.  Objects drawn only to the main context after a glowing object
//(draw order matters) will also obscure glowing items but will not have glow applied to their edges.
//
//Parameters:
//contextIn -		the 2d drawing context of a canvas on the calling page.
//contextWidth - 	the width of the canvas element that is the source of the passed context
//contextHeight - 	the height of the canvas element that is the source of the passed context
function setGlowOcclusionContext(contextIn, contextWidth, contextHeight)
{
	if(contextIn != null)
	{
		glowOcclusionContext = contextIn;	
		
		//create a buffer for the pixel data from this context
		if(glowOcclusionContext.createImageData != null)
		{
			glowOcclusionBuffer = glowOcclusionContext.createImageData(contextWidth, contextHeight);
		}
		else
		{
			//if the passed object can't create image data then it is not a 2D context.
			glowOcclusionContext = null;	
		}
	}
}


//***************
//Glow/occluding shapes
//
//The following functions draw various HTML5 Canvas shapes to the glow and occlusion buffers.  Those calls that have "WithGlow" in them will have
//their shapes drawn to the glow color buffer and glow pixels will be computed for them.  Those calls that have "WithOcclusion" will have their shapes
//drawn to the occlusion buffer.  While these shapes will not glow, the glow pixles of glowing shapes behind them will be drawn over these occluding shapes.
//
//Performance considerations:
//I've written these draw functions to gracefully handle things like null contexts and lack of browser support for HTML5 canvas.  I haven't done any
//benchmarking to see what (if any) speedup could be achieved by removing them, but if you're running up against performance limits you might consider
//removing the checks.  You will likely be calling these functions every frame, and some of these checks only safeguard against really unlikely edge cases, 
//so small changes might make a difference if your scene has a large number of shapes or your glow distance is large (more on that below in the glow 
//computation routines).  I leave it to you to do what makes the most sense for your speed / resiliency trade-offs.
//***************

//fillRectWithGlow
//
//perform the standard fillRect using the current state.  Then draw the required information to the glow contexts so
//that glow can be computed during the screen drawing process.
//
//Parameters:
//rectX - 					x-coordinate of the upper left-hand corner of the rectangle
//rectY - 					y-coordinate of the upper left-hand corner of the rectangle
//rectWidth - 				width of the rectangle
//rectHeight - 				height of the rectangle
//glowStartingAlpha256 - 	the desired alpha value of glow pixels drawn that immediately neighbor the pixels of the actual shape.  The lower
//							the value, the softer the overall glow looks.
//glowDistanceInPixels - 	the distance away from the actual shape in which glow pixels will still be computed and drawn.  The intensity
//							of the glow will diminish linearly over this distance until it is no longer visible.
function fillRectWithGlow(rectX, rectY, rectWidth, rectHeight, glowStartingAlpha256, glowDistanceInPixels)
{
	//draw to the screen context
	if(frameBufferContext != null && frameBufferContext.fillRect != null)
	{
		frameBufferContext.fillRect(rectX, rectY, rectWidth, rectHeight);
	}
	
	//use the same color to draw on the glow buffer (in the future different glow colors will necessitate some changes here)
	if(glowColorContext != null && glowColorContext.fillStyle != null)
	{
		glowColorContext.fillStyle = frameBufferContext.fillStyle;
		
		//draw to the glow color context
		glowColorContext.fillRect(rectX, rectY, rectWidth, rectHeight);
	}
	
	//draw the glow information (alpha, distance) to the occlusion buffer.
	if(glowOcclusionContext != null && glowOcclusionContext.fillStyle != null)
	{
		glowOcclusionContext.fillStyle = "rgba(" + glowStartingAlpha256 + ", " + Math.floor(frameBufferContext.globalAlpha * 255) + ", " + glowDistanceInPixels + ", 1.0)";
		glowOcclusionContext.fillRect(rectX, rectY, rectWidth, rectHeight);
	}
}

//fillRectWithOcclusion
//
//perform the standard fillRect using the current state.  Then draw the shape to the occlusion buffer so it will 
//block glow processing and have glow applied to its edges during the screen drawing process
//
//Parameters:
//rectX - 					x-coordinate of the upper left-hand corner of the rectangle
//rectY - 					y-coordinate of the upper left-hand corner of the rectangle
//rectWidth - 				width of the rectangle
//rectHeight - 				height of the rectangle
function fillRectWithOcclusion(rectX, rectY, rectWidth, rectHeight)
{
	//draw to the screen context
	if(frameBufferContext != null && frameBufferContext.fillRect != null)
	{
		frameBufferContext.fillRect(rectX, rectY, rectWidth, rectHeight);
	}
	
	//draw to the occlusion context.  The draw state will be changed to reflect that no glow will be computed for this object and that
	//it will have glow applied to it
	if(glowOcclusionContext != null && glowOcclusionContext.fillStyle != null)
	{
		glowOcclusionContext.fillStyle = "rgba(0, 0, 0, 1.0)";
		glowOcclusionContext.fillRect(rectX, rectY, rectWidth, rectHeight);
	}
}

//fillTextWithGlow
//
//draw text to the screen using the current state.  draw the same text in the same color to the glow buffer so it will have glow added to it.
//
//Parameters:
//textToDraw - 				the actual string that will be drawn
//textX - 					x-coordinate of the upper left-hand corner of the string
//textY - 					y-coordinate of the upper left-hand corner of the string
//glowStartingAlpha256 - 	the desired alpha value of glow pixels drawn that immediately neighbor the pixels of the actual shape.  The lower
//							the value, the softer the overall glow looks.
//glowDistanceInPixels - 	the distance away from the actual shape in which glow pixels will still be computed and drawn.  The intensity
//							of the glow will diminish linearly over this distance until it is no longer visible.
function fillTextWithGlow(textToDraw, textX, textY, glowStartingAlpha256, glowDistanceInPixels)
{
	//draw to the screen context
	if(frameBufferContext != null && frameBufferContext.fillText != null)
	{
		frameBufferContext.fillText(textToDraw, textX, textY);
	}
	
	//use the same color and font to draw on the glow buffer (in the future different glow colors will necessitate some changes here)
	if(glowColorContext != null && glowColorContext.fillText != null)
	{
		glowColorContext.font = frameBufferContext.font;
		glowColorContext.fillStyle = frameBufferContext.fillStyle;
		
		//draw to the glow color context
		glowColorContext.fillText(textToDraw, textX, textY);
	}
	
	//draw the glow information (alpha, distance) to the occlusion buffer.
	if(glowOcclusionContext != null && glowOcclusionContext.fillText != null)
	{
		glowOcclusionContext.font = frameBufferContext.font;
		glowOcclusionContext.fillStyle = "rgba(" + glowStartingAlpha256 + ", " + Math.floor(frameBufferContext.globalAlpha * 255) + ", " + glowDistanceInPixels + ", 1.0)";
		glowOcclusionContext.fillText(textToDraw, textX, textY);
	}
}

//fillTextWithOcclusion
//
//draw text so that it will obscure glowing objects, and so it will have glow applied to its edges
//
//Parameters:
//textToDraw - 	the actual string that will be drawn
//textX - 		x-coordinate of the upper left-hand corner of the string
//textY - 		y-coordinate of the upper left-hand corner of the string
function fillTextWithOcclusion(textToDraw, textX, textY)
{
	//draw to the screen context
	if(frameBufferContext != null && frameBufferContext.fillText != null)
	{
		frameBufferContext.fillText(textToDraw, textX, textY);
	}
	
	//draw the glow information (alpha, distance) to the occlusion buffer.
	if(glowOcclusionContext != null && glowOcclusionContext.fillText != null)
	{
		glowOcclusionContext.font = frameBufferContext.font;
		glowOcclusionContext.fillStyle = "rgba(0, 0, 0, 1.0)";
		glowOcclusionContext.fillText(textToDraw, textX, textY);
	}
}


//*********************
//Glow processing
//
//The following calls are used perform each phase of the glow pixel processing and composite operations.  Users of this library will generally call 
//these in the following order:
//clearContexts()
//computeGlow()
//compositeAndDraw()
//
//There normally shouldn't be any need for a developer to explicitly call computeGlowForPixel().  That is a utility function that is called 
//recursively by computeGlow().
//*********************

//clearContexts
//
//clear all four of the contexts (frame buffer, glow color, etc.).  Typically called once per frame to reset the drawing area.
//
//Parameters:
//canvasWidth -		the width of all four canvases (they should all be the same size)
//canvasHeight - 	the height of all four canvases (they should all be the same size)
function clearContexts(canvasWidth, canvasHeight)
{
	if(frameBufferContext != null && frameBufferContext.clearRect != null)
	{
		frameBufferContext.clearRect(0, 0, canvasWidth, canvasHeight);
	}
	
	if(glowColorContext != null && glowColorContext.clearRect != null)
	{
		glowColorContext.clearRect(0, 0, canvasWidth, canvasHeight);
	}
	
	if(glowOutputContext != null && glowOutputContext.clearRect != null)
	{
		glowOutputContext.clearRect(0, 0, canvasWidth, canvasHeight);	
	}
	
	if(glowOcclusionContext != null && glowOcclusionContext.clearRect != null)
	{
		glowOcclusionContext.clearRect(0, 0, canvasWidth, canvasHeight);	
	}
}


//computeGlowForPixel
//
//Given the passed pixel's position and the relative positions within the canvas of shapes that are glowing, determine how much (if any) glow should be
//applied to this pixel and what color it should be.  You generally won't call this function directly.  It is a utility function that is called 
//repeatedly by the computeGlow() function.  Most of its parameters are retrieved and updated in that function's body.
//
//Parameters:
//colorBuffer - 		a 2d buffer created by calling createImageData() from the context that represents your glow color buffer.  If you called
//						the setGlowColorContext() function in this library then the variable glowColorBuffer was populated with the buffer you
//						need and can be used as this parameter.
//occlusionBuffer - 	a 2d buffer created by calling createImageData() from the context that represents your occlusion buffer.  If you called
//						the setOcclusionContext() function in this library then the variable glowOcclusionBuffer was populated with the buffer you
//						need and can be used as this parameter.
//writeBuffer - 		a 2d buffer created by calling createImageData() from the context that represents your glow color buffer.  If you called
//						the setGlowOuputContext() function in this library then the variable glowOutputBuffer was populated with the buffer you
//						need and can be used as this parameter.
//canvasWidth - 		width of your canvas element (should be equal among all four canvases)
//canvasHeight - 		height of your canvas element (should be equal among all four canvases)
//pixelX - 				x-coordinate of the pixel being computed (in canvas coordinates, not window or screen coordinates)
//pixelY - 				y-coordinate of the pixel being computed (in canvas coordinates, not window or screen coordinates)
//glowRed256 - 			red component of the glow color (0-255)
//glowGreen256 - 		green component of the glow color (0-255)
//glowBlue256 - 		blue component of the glow color (0-255)
//alphaForPixel256 - 	alpha component for the glow pixel (0-255)
//glowDistance - 		total glow distance for this shape.  Always represents the initial value (doesn't decrease for farther pixels)
//glowIncrement - 		amount by which glow pixels' alpha should decrease each time they get one pixel further from the base 
//						shape (starting glow alpha / glow distance)
//isRootCall - 			true if this is the root call of this function for the related pixel, typically from within the for-loop in the computeGlow() function.  
//						false if this call is the result of a recursive call from another pixel, typically when checking the neighboring pixels of the 
//						pixel that was the subject of the root call.
function computeGlowForPixel(colorBuffer, occlusionBuffer, writeBuffer, canvasWidth, canvasHeight, pixelX, pixelY, glowRed256, glowGreen256, glowBlue256, alphaForPixel256, glowDistance, glowIncrement, isRootCall)
{
	//*****************
	//optimization - pass canvas width and height in.  Not as safe, but saves the overhead of six function calls to get values that probably won't change
	//******************
	
	//variables
	var errorOccurred = false;
	var thisPixelNeedsGlow = false;	//tests the occlusion buffer to see if this pixel is over the opaque part of the shape to which glow
									//is being applied.  If it is, no glow should be applied to it, and its neighboring pixels should not
									//have glow applied to them on this pass through the algorithm either (this is not to say they won't have
									//glow applied when other pixels are processed)
	var bufferOffsetForPixel;	//the linear memory offset of the pixel data.  A frequently used offset that requires several multiplies to compute, so it's
								//faster to compute it once and store it.
	var adjustedAlpha;	//if a shape is drawn with an alpha less that 1.0 (or less than 255 in the 8-bit world), the starting alpha of the glow
						//should be reduced accordingly to make the glow proportional.
	
	//boundary checks for the pixel
	if(pixelX < 0 || (pixelX >= canvasWidth))
	{
		errorOccurred = true;
	}
	
	if(pixelY < 0 || (pixelY >= canvasHeight))
	{
		errorOccurred = true;
	}
	
	if(errorOccurred == false)
	{
		
		//compute the buffer offset for this pixel
		bufferOffsetForPixel = (((pixelY * canvasWidth) + pixelX) * 4);
		
		//if this pixel is part of the shape, it does not need to have glow applied to it.
		if(occlusionBuffer.data[bufferOffsetForPixel + 1] != 0)	
		{
			thisPixelNeedsGlow = false;
		}
		else
		{
			thisPixelNeedsGlow = true;
		}
		
		//compute the alpha of the glow pixel that will be written to this location.  This is the original passed alpha value reduced accordingly
		//by any transparency applied to the shape itself.
		adjustedAlpha = alphaForPixel256;	
		
		//if any existing glow value already on this pixel is less than the glow about to be applied, apply the glow.
		if(writeBuffer.data[bufferOffsetForPixel + 3] < adjustedAlpha)
		{
		
			if(thisPixelNeedsGlow == true)
			{
				//apply the specified alpha to the specified pixel

				//color values
				//red
				writeBuffer.data[bufferOffsetForPixel] = glowRed256;
				
				//green
				writeBuffer.data[bufferOffsetForPixel + 1] = glowGreen256;
				
				//blue
				writeBuffer.data[bufferOffsetForPixel + 2] = glowBlue256;
				
				//alpha
				
				//there are some odd cases where the pixel to which glow is being applied is not opaque (pixels that are part of anti-aliasing, for
				//example).  If the alpha of the pixel is less that the alpha of the glow being applied, lower the alpha of the glow to account for that
				//since it looks strange if the glow pixel is brighter than the actual pixel.  Do this on the root call only, since otherwise this test
				//would be done on pixels to which glow was being applied, and the value in the occlusion buffer is 0, which would cause no glow to
				//be drawn.
				
				if((alphaForPixel256 > occlusionBuffer.data[bufferOffsetForPixel + 1]) && isRootCall == true)
				{
					alphaForPixel256 = occlusionBuffer.data[bufferOffsetForPixel + 1];
				}
				
				writeBuffer.data[bufferOffsetForPixel + 3] = adjustedAlpha;
				
				
			}
			else
			{
				//in cases where this pixel doesn't need glow, see if this is the root call or one of the recursive calls.  If it is the root call, make
				//the recursive pixel calls below.  If it isn't, make the alpha zero so the recursive calls stop.
				//Why is this here? - In cases where the root pixel is causing the glow the recursive calls need to be made for all the neighbors.
				//if one of the neighbors is also part of the shape (and therefor doesn't need to have glow applied to it), this allows the routine
				//to halt any recursive calls that might have been made unnecessarily on behalf of that neighboring pixel.
				if(isRootCall == false)
				{
					alphaForPixel256 = 0;
				}
			}
			
			//compute the glow for the neighboring pixels
			alphaForPixel256 = alphaForPixel256 - glowIncrement;
			
			if(alphaForPixel256 > 0)
			{
				//apply glow to the neighboring pixels
				//north
				computeGlowForPixel(colorBuffer, occlusionBuffer, writeBuffer, canvasWidth, canvasHeight, pixelX, pixelY - 1, glowRed256, glowGreen256, glowBlue256, alphaForPixel256, glowDistance, glowIncrement, false);
				
				//north-east
				computeGlowForPixel(colorBuffer, occlusionBuffer, writeBuffer, canvasWidth, canvasHeight, pixelX + 1, pixelY - 1, glowRed256, glowGreen256, glowBlue256, alphaForPixel256, glowDistance, glowIncrement, false);
				
				//east
				computeGlowForPixel(colorBuffer, occlusionBuffer, writeBuffer, canvasWidth, canvasHeight, pixelX + 1, pixelY, glowRed256, glowGreen256, glowBlue256,alphaForPixel256, glowDistance, glowIncrement, false);
				
				//south-east
				computeGlowForPixel(colorBuffer, occlusionBuffer, writeBuffer, canvasWidth, canvasHeight, pixelX + 1, pixelY + 1, glowRed256, glowGreen256, glowBlue256, alphaForPixel256, glowDistance, glowIncrement, false);
				
				//south
				computeGlowForPixel(colorBuffer, occlusionBuffer, writeBuffer, canvasWidth, canvasHeight, pixelX, pixelY + 1, glowRed256, glowGreen256, glowBlue256, alphaForPixel256, glowDistance, glowIncrement, false);
				
				//south-west
				computeGlowForPixel(colorBuffer, occlusionBuffer, writeBuffer, canvasWidth, canvasHeight, pixelX - 1, pixelY + 1, glowRed256, glowGreen256, glowBlue256, alphaForPixel256, glowDistance, glowIncrement, false);
				
				//west
				computeGlowForPixel(colorBuffer, occlusionBuffer, writeBuffer, canvasWidth, canvasHeight, pixelX - 1, pixelY, glowRed256, glowGreen256, glowBlue256,  alphaForPixel256, glowDistance, glowIncrement, false);
				
				//north-west
				computeGlowForPixel(colorBuffer, occlusionBuffer, writeBuffer, canvasWidth, canvasHeight, pixelX - 1, pixelY - 1, glowRed256, glowGreen256, glowBlue256, alphaForPixel256, glowDistance, glowIncrement, false);
			}//end of if alphaForPixel256 > 0
		}//end of if the alpha already in the write buffer is lower than the alpha that should be written
	}//end of if no error occurred.
}

//computeGlow
//
//Apply scene-wide glow.  Get updated image buffer data from each of the three off-screen contexts.  Use that data to process each
//pixel in the image, adding glow to the glow write buffer where appropriate.
function computeGlow()
{
	//glow the buffer as needed
	
	//update the occlusion buffer with data from the occlusion context (now includes things that were drawn to it)
	glowOcclusionBuffer = glowOcclusionContext.getImageData(0, 0, canvasWidth, canvasHeight);
	
	//update the glow write buffer with its cleared context
	glowOutputBuffer = glowOutputContext.getImageData(0, 0, canvasWidth, canvasHeight);
	
	//update teh glow color buffer now that it has things drawn to it
	glowColorBuffer = glowColorContext.getImageData(0, 0, canvasWidth, canvasHeight);
	
	//for each pixel
	for(xLoop = 0; xLoop < (canvasWidth * canvasHeight * 4); xLoop = xLoop + 4)
	{
		//check the occlusion buffer for alpha > 0 (does this pixel even need to have glow applied to it?)
		if(glowOcclusionBuffer.data[xLoop + 1] > 0)
		{
			//figure out which pixel is having glow applied
			computedPixelX = Math.floor(xLoop / 4) % canvasWidth;
			computedPixelY = Math.floor(Math.floor(xLoop / 4) / canvasWidth);
			
			//get the glow characteristics from the occlusion buffer
			glowDistance = glowOcclusionBuffer.data[xLoop + 2];
			
			//if the pixel to which glow will be applied is part of a shape that is not completely opaque,
			//adjust the starting alpha of the glow downward to reflect that partial transparency.  For example, 
			//if the starting alpha for the glow was 70%, but the shape itself was 50% transparent, then the 
			//actual starting alpha for the glow should be 35% (70% * 50%) rather than 70%.
			if(glowOcclusionBuffer.data[xLoop + 1] != 255)
			{
				glowStartingAlphaAdjustment = 1 - (glowOcclusionBuffer.data[xLoop + 1] / 255);
			}
			else
			{
				glowStartingAlphaAdjustment = 0;
			}
			glowStartingAlpha = glowOcclusionBuffer.data[xLoop] - (glowStartingAlphaAdjustment * glowOcclusionBuffer.data[xLoop]);
			
			//compute the amount by which each further pixel's alpha should be reduced to display a linearly decreasing glow.
			glowIncrement = Math.floor(glowStartingAlpha/glowDistance);
			
			//get the glow color from the color buffer
			glowRed = glowColorBuffer.data[((computedPixelY * canvasWidth) + computedPixelX) * 4];
			glowGreen = glowColorBuffer.data[(((computedPixelY * canvasWidth) + computedPixelX) * 4) + 1];
			glowBlue = glowColorBuffer.data[(((computedPixelY * canvasWidth) + computedPixelX) * 4) + 2];
			
			//recursively compute the glow for this pixel and neighboring pixels.
			computeGlowForPixel(glowColorBuffer, glowOcclusionBuffer, glowOutputBuffer, canvasWidth, canvasHeight, computedPixelX, computedPixelY, glowRed, glowGreen, glowBlue, glowStartingAlpha, glowDistance, glowIncrement, true);
		}
	}//next pixel
}

//compositeAndDraw
//
//Write the contents of the glow buffer to the frame buffer and draw it to the screen.
//
//Parameters:
//glowWriteBufferElement - the actual DOM element id that represents the <canvas> to which glow pixels are written (this is NOT the frame buffer)
function compositeAndDraw(glowWriteBufferElement)
{
	//write the data from the glow output buffer (the buffer to which glow pixels were written during computeGlow) to the glow write context
	glowOutputContext.putImageData(glowOutputBuffer, 0, 0);
	
	//composite the glow pixels with the rest of the pixels on the frame buffer
	frameBufferContext.drawImage(glowWriteBufferElement, 0, 0);
}
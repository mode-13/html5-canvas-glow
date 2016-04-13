# html5-canvas-glow
Per-pixel glow for HTML5 canvas shapes and text

## Summary
This file contains variables and functions that allow you to draw HTML5 canvas rectangles and text that glow and whose glow is properly occluded by other shapes you draw in front of them.  By this I mean that the glow will bleed over occluding objects at the proper adjacent pixels (for some visual examples of this see the links below).  The glow computation in these routines is per-pixel (as opposed to techniques that scale the entire object and reduce the alpha while drawing it multiple times).

## Examples of how it works
Here are some links to pages using this so you can get a sense of what it does.

[http://mode13.com/glow_buffer_demo.php](http://mode13.com/glow_buffer_demo.php) - Interactive so you can see its real-time capability.

[http://mode13.com/glow_buffer_demo_2.php](http://mode13.com/glow_buffer_demo_2.php) - A more visually interesting example to give you some ideas.

## Four buffers / contexts
Most of this library relies on the presence of four canvas elements, three of which are hidden and used as off-screen drawing/compositing spaces.  When you include this Javascript library on a page you need to create the four canvas elements in the DOM on the same page and provide them with ids that can be passed to these functions.  You will also need to hide every buffer but the frame buffer (though I sometimes make them visible if I'm debugging and need to see what's being written) with something like style.display = "none";  don't worry, they can still be the target of draw and composite calls even if they're not visible. The code repeatedly refers to the following canvas elements and their related drawing contexts:

  **Frame buffer** - The only visible canvas element of the four, this is the element to which the final image will be drawn.  Shapes that aren't	part of the glow calculation (either aren't glowing or aren't meant to occlude shapes that are glowing) can be drawn directly	to this buffer, though draw order will matter.
  
  **Glow Color buffer** - Contains the color that should be used to draw the glow pixels.  Any shape or text drawn using a "WithGlow" routine will have its color drawn to this buffer.  If you want a shape's glow color to be different than its regular color, you could simply	write that different glow color to this buffer instead and the pixel plotting routine would use it properly, though I haven't	implemented that in this version (when you draw a glowing shape the shape's original color is also written to this buffer).
  
  **Glow Output buffer** - The destination for glow pixel writes.  This buffer only contains glow pixels, not the pixels of the shape that is glowing. This buffer is composited to the frame buffer just before the frame buffer is presented.
  
  **Glow parameter buffer** - 	Glow parameters and shapes that should occlude a glowing object are written here. Instead of colors, each "pixel" contains information about how the glow should be computed. For each 32-bit pixel, this buffer contains:
  
    Byte 1 - Alpha value at which the first glow pixel away from the shape should start (0 - 255)
    Byte 2 - The alpha of the underlying shape. This is relevant because as this shape is fading from opaque to transparent, the alpha of its glow should be reduced accordingly (0 - 255).
    Byte 3 - Glow distance in pixels (0 - 255).
    Byte 4 - This is always 1.0 so that the data written to this buffer isn't altered by compositing operations.
    
## Only text and rectangles?  How can I add other HTML5 canvas shapes to this so they glow / occlude as well?
It's fairly simple to add other canvas shapes to this library.  I wrote the pixel plotting algorithms to work with any pixels that are on those related buffers, so all you need to do is draw other shapes to those buffers; the glow / occlusion calculation will handle the rest.

For example, to draw the glowing rectangle in the drawRectWithGlow() call, all I'm doing is using standard canvas API calls to draw the rectangle to the frame buffer context, then using those same stroke and fill states to draw the rectangle again on the glow color buffer.  Finally, I gather the glow parameter information (initial glow intensity and glow distance), assemble an RGBA value that incorporates them, then draw the same rectangle one last time to the glow parameter / occlusion buffer using that color (which is really packed parameters) as the fill color.

In order to add your own shapes to this library all you'd have to do is add a function that takes enough parameters to call the standard canvas API call (for example, my drawRectWithGlow() function has to accept x,y coordinates and width and height because I need those for the base canvas drawRect() calls), and then make the adjustments I mentioned above to draw the shapes again to each relevant buffer.

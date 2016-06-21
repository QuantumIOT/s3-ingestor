/**
 * returns true or false depending on whether or not the element is in array
 * @param element
 * @param array
 * @returns {boolean}
 */

var _ = require('lodash');


function elementIsInArray(element, array) {
	return array.indexOf(element) !== -1;
}

function elementIsNotInArray(element, array) {
	return array.indexOf(element) === -1;
}



// Lets test if elements in destination array are in source array
source = ["test1", "test3", "test5", "test6", "test4"];
destination = ["test1", "test3", "test10"];

console.log("These are the same in the destination and the souce: ")
for (var i = 0; i < destination.length; i++)
{
	if (elementIsInArray(destination[i], source)){
		console.log(destination[i])	// prints whats in the destination that is also in the source
	}

}
// lets test to see if elements in destination array are not in source array

console.log("\nThe following are different in the destination: ")
for (var i = 0; i < destination.length; i++)
{
	if (elementIsNotInArray(destination[i], source)) {
		console.log(destination[i]) // prints whats not in the source, this is what needs to be deleted
	}
}
/* ============================================================================== */


// Now lets test if a certain key is in an object
my_object ={"test1": "/blah/blah/test1",
			"test2": "/blah/foo/test2",
			"test3":"/foo/blah/test3",
			"test4": "/foo/blah/test4"};

my_array = ["test1", "test5", "test4", "test9"]


console.log("\nThis checks if a certain key is in the object:")
for (var j = 0; j < my_array.length; j++){
	if ((my_array[j] in my_object)){
		console.log("Yes, found this element as a key in my object: " + my_array[j] )
	}
}

console.log("\nThis checks if a certain key is NOT in the object:")
for (var k = 0; k < my_array.length; k++){
	if (!(my_array[k] in my_object)){
		console.log("No, this one is not a key in my object: " + my_array[k] )
	}
}

console.log(_.keys(my_object))
// console.log("\n iterating over object: ")
// for (someKey in my_object)
// {
// 	console.log(someKey, my_object[someKey])
// }

// list comprehension
// in, not in,
// object.keys
// object.values
// underscore.js


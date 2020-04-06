var gs = require("./pulh-gamestate");
var fs = require("fs");

if (process.argv.length<3) {
    console.error("Required: Last parameter must be path to log file");
    process.exit(1);
}

var fn = process.argv[2];
var log = fs.readFileSync(fn);
log = log.toString().split("\n");

var config = {
    assisttime: 20.0, //10 seconds max time player touch before goal to count as assist
};

//gs.Reset(); //not needed here. could be used to break up totals into 'game' totals every 3 periods, for example
var period = gs.NewPeriod(config);
var state;

for (var i=0; i<log.length; i++)
{
    var line = log[i];
    state = period.ProcessLine(line);
    if (state.periodOver) {
        outputState(state);
        period = gs.NewPeriod(config);
    }
}
if (period.GetState().startTime>0)
    outputState(period.GetState());
        
console.log("Totals");
console.log(gs.GetTotals());
console.log("----------------");

console.log("Goal array count: "+state.goals.length);

function outputState(state) {
    console.log("Period "+state.period);
    delete state.blueTouches;
    delete state.greenTouches;
    console.log(state);
    console.log("------------------");
}
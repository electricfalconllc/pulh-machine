var gs = require("./pulh-gamestate");
var fs = require("fs");
var Discord = require("discord.js");
var querystring = require('querystring');
var http = require('http');
var client = new Discord.Client();

/* Example config:
{
  "channelId":"channel-id-from-discord-here",
  "login":"bot-token-goes-here",
  "server":"naeast2"
}
*/
var config = JSON.parse(fs.readFileSync('./botconfig.json'));
var logfilepath = '../pulh-event-log.txt';

var pdconfig = {
  assisttime: 20.0, 
};

var period = gs.NewPeriod(pdconfig);
var lastperiod = null;
var state = null;
var chan = null;

//read in existing log file to this point
var lastlog=fs.readFileSync(logfilepath).toString();
var log = lastlog.split("\n");
for (var i=0; i<log.length; i++)
{
  var line = log[i];
  state = period.ProcessLine(line);
  if (state.periodOver) {
    lastperiod = state;
    period = gs.NewPeriod(pdconfig);
  }
}

//post to config urls for stat db
function postStats(st) {
  for (var i=0; i<config.postStatUrls.length; i++) {
    var u = config.postStatUrls[i];
    var post_data = querystring.stringify({
      'server' : config.server,
      'game': JSON.stringify(st),
    });
    var post_options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(post_data)
      }
    };
    var post_req = http.request(u, post_options, function(res) {
      res.setEncoding('utf8');
      res.on('data', function (chunk) {
        // report errors in the future
      });
    });
    
    post_req.write(post_data);
    post_req.end();
  }
}

//message pretty output of stats to chan
function sendStatMessage(st) {
  if (st==null) {
    chan.send("No completed periods available.");
    return;
  }
  var s = prettify(st);
  chan.send(s);
  console.log(s);
}

function prettyline(wrap, l) {
  var l=wrap+l+wrap+"\n";
  return l;
}

function colval(s, num) {
  if (typeof num=="undefined") num=8;
  return s.toString().rpad(" ",num);
}

function colvall(s, num) {
  if (typeof num=="undefined") num=8;
  return s.toString().lpad(" ",num);
}

function prettify(st) {
  var s = "\n";
  s+=prettyline("**","Stats for "+config.server);
  s+=prettyline("**","Period "+st.period+", Ended: "+(new Date()).toISOString());
  s+=prettyline("**","Blue: "+st.blueScore+" | Green: "+st.greenScore);
  
  var players = [];

  var topgoals=0;
  var topassist=0;
  var toppoints=0;
  var topgoalsp="";
  var topassistp="";
  var toppointsp="";
  for (var k in st.players) {
    var p = st.players[k];
    if (p.goals>topgoals) {
      topgoals=p.goals;
      topgoalsp=k;
    }
    if (p.primaryassists+p.secondaryassists>topassist) {
      topassist=p.primaryassists+p.secondaryassists;
      topassistp=k;
    }
    if (p.goals+p.primaryassists+p.secondaryassists>toppoints) {
      toppoints=p.goals+p.primaryassists+p.secondaryassists;
      toppointsp=k;
    }
    if (k=="" && p.goals>0) k="<own-goal>";
    players.push({
      name: k,
      team: p.team,
      goals: p.goals,
      assists: p.primaryassists+p.secondaryassists,
      hits: p.hits,
      icing: p.icing,
    });
  }
  if (topgoalsp!="")
    s+=prettyline("*","Most Goals: "+topgoalsp+" - "+topgoals.toString());
  if (topassistp!="")
    s+=prettyline("*","Most Assists: "+topassistp+" - "+topassist.toString());
  if (toppointsp!="")
    s+=prettyline("*","Most Points: "+toppointsp+" - "+toppoints.toString());
  
  s+=prettyline("","");
  s+=prettyline("**","Team Stats");
  s+=prettyline("","```");
  s+=prettyline("","          |Blue    |Green   ");
  s+=prettyline("","      Hits|"+colval(st.teams['blue'].hits)+"|"+colval(st.teams['green'].hits));
  s+=prettyline("","Posessions|"+colval(st.teams['blue'].posessions)+"|"+colval(st.teams['green'].posessions));
  s+=prettyline(""," Pipe Hits|"+colval(st.teams['blue'].pipehits)+"|"+colval(st.teams['green'].pipehits));
  s+=prettyline("","     Icing|"+colval(st.teams['blue'].icing)+"|"+colval(st.teams['green'].icing));
  s+=prettyline("","     Saves|"+colval(st.teams['blue'].saves)+"|"+colval(st.teams['green'].saves));
  s+=prettyline("","```");

  s+=prettyline("**","Player Stats");
  s+=prettyline("","```");
  s+=prettyline("",colvall("Player",16)+"|"+colval("Team",5)+"|"+colval("Goal",4)+"|"+colval("Asst",4)+"|"+colval("Hits",4)+"|"+colval("Iced",4));
  for (var i=0; i<players.length; i++) {
    var p = players[i];
    if (p.name!=""){
      s+=prettyline("",colvall(p.name,16)+"|"+colval(p.team,5)+"|"+colval(p.goals,4)+"|"+colval(p.assists,4)+"|"+colval(p.hits,4)+"|"+colval(p.icing,4));
    }
  }
  s+=prettyline("","```");
  
  return s;
}

String.prototype.lpad = function(padString, length) {
  var str = this;
  while (str.length < length)
      str = padString + str;
  return str;
}

String.prototype.rpad = function(padString, length) {
  var str = this;
  while (str.length < length)
      str = str+padString;
  return str;
}

//connect to discord channel
client.on("ready", async () => {
  console.log("I am ready!");
  chan = await client.channels.fetch(config.channelId);
  
  if (typeof chan=='undefined' || chan==null)
  {
    console.log("Error, channel not found");
    process.exit(1);
  }  

  fs.watchFile(logfilepath, { interval: 5000 }, (curr, prev) => {
    //console.log('File event.');
    if (curr.size > prev.size) {
      console.log('File changed size:' +prev.size.toString()+" > "+curr.size.toString());
      //get line changes and run through the state manager
      var logtext=fs.readFileSync(logfilepath).toString();
      log=logtext.substring(lastlog.length).split("\n");
      lastlog=logtext;
      for (var i=0; i<log.length; i++) {
        var line = log[i];
        state = period.ProcessLine(line);
        if (state.periodOver) {
            sendStatMessage(state);
            postStats(state);
            lastperiod = state;
            period = gs.NewPeriod(pdconfig);
        }
      }      
    }
  });
});

client.on("message", async message => {
  if(message.author.bot) return;

  if(message.content.indexOf("!") !== 0) return;

  if(message.content === "!stats "+config.server) {
	  sendStatMessage(lastperiod);
  }
});


client.login(config.login);

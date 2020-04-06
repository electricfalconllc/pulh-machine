
exports._periodCount = 0;
exports._totals = {
    players: {},
    teams: {},
};
exports._emptyTotals = exports._totals;

exports.Reset = function() {
    exports._periodCount=0;
    exports._totals = exports._emptyTotals;
}
exports.GetTotals = function() {
    return exports._totals;
}
exports.NewPeriod = function(config) {
    if (typeof config.assisttime=="undefined") return null;

    exports._periodCount++;
    period = {
        "config": config,
        state: {
            period: exports._periodCount,
            blueTouches:[],
            greenTouches:[],
            blueScore: 0,
            greenScore: 0,
            goals:[],
            pipeHits:[],
            startTime:0,
            endTime:0,
            periodOver:false,
            players:{},
            winTeam: "",
            teams: {},
            lastTimestamp:-1,
        },
        GetState: function() {
            return this.state;
        },        
        ProcessLine: function(line) {
            line = line.replace(/\r/g, ""); //good ol' windows
            if (countVals(line)==0) return this.state;
            var timestamp = parseFloat(getVal(line, 0));
            if (this.state.startTime==0)
                this.state.startTime=timestamp;

            if (this.state.lastTimestamp >= timestamp) //dont process old events?
                return this.state;
                
            var type=getVal(line, 1);
            switch (type) {
                /*
                <timestamp> collide puck player <playername> <team> <stick/body> <networkId>
                <timestamp> pipe-hit puck pipe <goal-team>
                <timestamp> check <player> <player-checked>
                <timestamp> goal server - <team> <lasttouchedteamplayer> <bluescore> <greenscore> <periodtime-elapsed>
                <timestamp> period-end server - <bluescore> <greenscore>
                */
                case "collide":
                    this._handleCollide(line, timestamp);
                    break;
                case "pipe-hit":
                    this._handlePipe(line, timestamp);
                    break;
                case "goal":
                    this._handleGoal(line, timestamp);
                    break;
                case 'check':
                    this._handleCheck(line, timestamp);
                    break;
                case "period-end":
                    this._handleEnd(line, timestamp);
                    break;
                case "log-started":
                    //this._handleLogStarted(line, timestamp);
                    break;
                case "faceoff":
                    this._handleFaceoff(line, timestamp);
                    break;
                default: 
                    console.log("Warning: Unknown event type - "+type+", line: "+line);
            }
            return this.state;
        },
        _addPlayerIfNotExist: function(name) {
            var z={
                team:"",
                goals:0,
                primaryassists:0,
                secondaryassists:0,
                hits:0,
                checked:0,
                posessions:0,
                pipehits:0,
                periods:1,
            };
            if (typeof this.state.players[name]=="undefined")
                this.state.players[name]=z;
            if (typeof exports._totals.players[name]=="undefined") {
                exports._totals.players[name] = {};
                Object.assign(exports._totals.players[name], z);
                exports._totals.players[name].periods = 0;
            }
        },
        _addTeamIfNotExist: function(name) {
            var z={
                hits:0,
                checked:0,
                posessions:0,
                pipehits:0,
                goals:0,
            };
            if (typeof this.state.teams[name]=="undefined")
                this.state.teams[name]=z;
            if (typeof exports._totals.teams[name]=="undefined") {
                exports._totals.teams[name] = {};
                Object.assign(exports._totals.teams[name], z);
            }
        },
        _handleFaceoff: function(line, timestamp) {
            this.state.blueTouches=[];
            this.state.greenTouches=[];
        },
        _handleCollide: function(line, timestamp) {
            //<timestamp> collide puck player <playername> <team> <stick/body> <networkId>
            this._addPlayerIfNotExist(getVal(line, 4));
            if (getVal(line, 2)=="puck" && getVal(line,3)=="player") {
                if (getVal(line, 5)=="green") {
                    this._addTeamIfNotExist("green");
                    this.state.players[getVal(line,4)].team = "green";
                    this.state.players[getVal(line,4)].posessions++;
                    this.state.teams['green'].posessions++;
                    this.state.greenTouches.push({
                        player: getVal(line,4),
                        part: getVal(line,6),
                        netid: getVal(line, 7),
                        time: timestamp,
                    }); 
                } else {
                    this._addTeamIfNotExist("blue");
                    this.state.players[getVal(line,4)].team = "blue";
                    this.state.players[getVal(line,4)].posessions++;
                    this.state.teams['blue'].posessions++;
                    this.state.blueTouches.push({
                        player: getVal(line,4),
                        part: getVal(line,6),
                        netid: getVal(line, 7),
                        time: timestamp,
                    }); 
                }
            }
        },
        _handleEnd: function(line, timestamp) {
            this.state.blueScore = parseInt(getVal(line, 4));
            this.state.greenScore = parseInt(getVal(line, 5));
            if (this.state.blueScore>this.state.greenScore)
                this.state.winTeam="blue";
            else if (this.state.blueScore<this.state.greenScore)
                this.state.winTeam="green";
            else 
                this.state.winTeam="";
            this.state.periodOver=true;
            this.state.endTime = timestamp;
            this._updateTotals();
        },
        _handleCheck: function(line, timestamp) {
            var checker=getVal(line, 2);
            var checked=getVal(line, 3);
            this._addPlayerIfNotExist(checker);
            this._addPlayerIfNotExist(checked);
            this.state.players[checker].hits++;
            this.state.players[checked].checked++;
            if (this.state.players[checker].team!="") {
                this.state.teams[this.state.players[checker].team].hits++;
            }
            if (this.state.players[checked].team!="") {
                this.state.teams[this.state.players[checked].team].checked++;
            }
        },
        _handlePipe: function(line, timestamp) {
            var t=getVal(line,4);
            this._addTeamIfNotExist(t);
            this.state.pipehits.push({
                time: timestamp-this.state.startTime,
                team: t,
            });
            this.state.teams[t].pipehits++;
            if (t=="blue") {
                var ph = getPrimaryAssist(this.state.blueTouches, timestamp, config);
                this.state.players[ph].pipehits++;
            } else {
                var ph = getPrimaryAssist(this.state.greenTouches, timestamp, config);
                this.state.players[ph].pipehits++;
            }
        },
        _handleGoal: function(line, timestamp) {
            //<timestamp> goal server - <team> <lasttouchedteamplayer> <bluescore> <greenscore> <periodtime-elapsed>
            var t=getVal(line, 4);
            var pg=getVal(line, 5);
            var othert = t=="blue"?"green":"blue";
            this._addTeamIfNotExist(t);
            this._addTeamIfNotExist(othert);            
            this._addPlayerIfNotExist(pg);   
            this.state.players[pg].team = t;      
            this.state.players[pg].goals++;
            this.state.teams[t].goals++;
            if (this.state.teams[t].goals > this.state.teams[othert].goals) {
                this.state.winTeam=t;
            } else if (this.state.teams[t].goals == this.state.teams[othert].goals) {
                this.state.winTeam="";
            }

            var pa="";
            var sa="";
            var og="";
            if (t=="blue"){
                this.state.blueScore++;
                pa = getPrimaryAssist(this.state.blueTouches, timestamp, this.config);
                sa = getSecondaryAssist(this.state.blueTouches, timestamp, this.config);
            } else {
                this.state.greenScore++;
                pa = getPrimaryAssist(this.state.greenTouches, timestamp, this.config);
                sa = getSecondaryAssist(this.state.greenTouches, timestamp, this.config);
            }

            if (pg==pa)
                pa="";
            if (pg==sa)
                sa="";

            if (sa!="") {
                this._addPlayerIfNotExist(sa);
                this.state.players[sa].secondaryassists++;
            }
            if (pa!="") {
                this._addPlayerIfNotExist(pa);
                this.state.players[pa].primaryassists++;
            }
            
            this.state.goals.push({
                team: t,
                scorer: pg,
                primaryassist: pa,
                secondaryassist: sa,
                time: parseFloat(getVal(line, 8)),
            });
            
            this.state.blueTouches=[];
            this.state.greenTouches=[];
        },
        _updateTotals: function() {
            for (var k in this.state.players) {
                var p = this.state.players[k];
                for (var v in p) {
                    if (v!="team")
                        exports._totals.players[k][v]+=p[v];
                }
            }

            for (var k in this.state.teams) {
                var t = this.state.teams[k];
                for (var v in t) {
                    exports._totals.teams[k][v]+=t[v];
                }
            }
        },
    };
    return period;
}

function getPrimaryAssist(touches, time, config) {
    touches = JSON.parse(JSON.stringify(touches));
    var r="";
    touches.pop();//pop an xtra because its presumably the goal scorer
    var a = touches.pop();
    if (typeof a!="undefined") {
        if (time - a.time <= config.assisttime) {
            r = a.player;
        }
    }
    return r;
}

function getSecondaryAssist(touches, time, config) {
    touches = JSON.parse(JSON.stringify(touches));
    touches.pop();
    return getPrimaryAssist(touches, time, config);
}

function countVals(line) {
    if (line=="") return 0;
    return line.split("\t").length+1;
}

function getVal(line, index) {
    var c=countVals(line)
    if (index<c) return line.split("\t")[index]; 
    return "";
}


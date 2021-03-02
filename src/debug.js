var util = require('./utils');
var debug = require('debug');

// debug module patch adapted from
// https://github.com/visionmedia/debug/issues/582#issuecomment-418185850

module.exports = function (label) {
  debug.formatArgs = formatArgs;
  function formatArgs(args) {
    let name = this.namespace;
    let useColors = this.useColors;
    let dateTime = util.getCurrentDateTimeAsString()
    if (useColors) {
      let c = this.color;
      let colorCode = '\u001b[3' + (c < 8 ? c : '8;5;' + c);
      let prefix = ' ' + colorCode + ';1m' + name + ' ' + '\u001b[0m';
      args[0] = dateTime + prefix + args[0].split('\n').join('\n' + '                       ' + prefix);
      args.push(colorCode + 'm+' + debug.humanize(this.diff) + '\u001b[0m');
    } else {
      args[0] = dateTime + ' ' + name + ' ' + args[0].split('\n').join('\n' + '                       ' + name);
    }
  }
  return debug(label)
}

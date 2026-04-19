CREATE TABLE IF NOT EXISTS `talkbody2` (
  `TalkID` int(11) NOT NULL,
  `Text` mediumtext,
  `ProcessedText` mediumtext,
  `RawText` mediumtext,
  `TagVector` mediumblob,
  PRIMARY KEY (`TalkID`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8;

CREATE TABLE IF NOT EXISTS `talkbody2_es` (
  `TalkID` int(11) NOT NULL,
  `Text` mediumtext,
  `ProcessedText` mediumtext,
  `RawText` mediumtext,
  `TagVector` mediumblob,
  PRIMARY KEY (`TalkID`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8;

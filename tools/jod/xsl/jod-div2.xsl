<?xml version="1.0" encoding="ISO-8859-1"?>
<?xml-stylesheet type="text/xsl" version="1.0"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="html" indent="no" />
<xsl:strip-space elements="*"/>
<xsl:preserve-space elements="i smallcap Paragraph"/>
<xsl:template match="/">
    <div id="jContent">
        <xsl:text>&#10;</xsl:text>
        <xsl:apply-templates select="/Discourse/DiscourseHeader"/>
        <xsl:apply-templates select="/Discourse"/>
        <xsl:text>&#10;</xsl:text>
    </div>
</xsl:template>
<xsl:template match="Discourse">
    <div class="discourseBody">
        <xsl:attribute name="id">d<xsl:value-of select="@DNo" /></xsl:attribute>
        <xsl:text>&#10;</xsl:text>
        <xsl:apply-templates select="*[not(self::DiscourseHeader)]"/>
        <xsl:text>&#10;</xsl:text>
    </div>
</xsl:template>
<xsl:template match="DiscourseHeader">
    <div class="discourseHeader">
        <xsl:text>&#10;</xsl:text>
        <div class="title"><xsl:value-of select="Title"/></div>
        <xsl:text>&#10;</xsl:text>
        <div class="subtitle"><xsl:value-of select="Subtitle"/></div>
        <xsl:text>&#10;</xsl:text>
        <div class="discourseInfo">
        <xsl:text>&#10;</xsl:text>
        <div class="reportedBy">Reported By: <xsl:value-of select="ReportedBy"/></div>
        <xsl:text>&#10;</xsl:text>
        <div class="pageHeader">Page Header: <xsl:value-of select="PageHeader"/></div>
        <xsl:text>&#10;</xsl:text>
        <div class="speaker">Speaker: <xsl:value-of select="../@Speaker"/></div>
        <xsl:text>&#10;</xsl:text>
        <div class="date">Date: <xsl:value-of select="../@Date"/></div>
        <xsl:text>&#10;</xsl:text>
        </div>
        <xsl:text>&#10;</xsl:text>
    </div>
</xsl:template>
<xsl:template match="Paragraph">
    <xsl:element name="div">
        <xsl:attribute name="class">paragraph jod</xsl:attribute>
        <xsl:attribute name="id">v<xsl:value-of select="@Vol"
                               />n<xsl:value-of select="@No"/></xsl:attribute>
        <xsl:value-of select="self"/>
        <xsl:apply-templates/>
    </xsl:element>
</xsl:template>
<xsl:template match="i">
<span class="italic">
  <xsl:value-of select="self::*"/>
</span>
</xsl:template>
<xsl:template match="indent">
<div class="indent">
  <xsl:value-of select="self::*"/>
  <xsl:apply-templates/>
</div>
</xsl:template>
<xsl:template match="strong">
    <span class="bold">
        <xsl:value-of select="self::*"/>
        <xsl:apply-templates/>
    </span>
</xsl:template>
<xsl:template match="smallcap">
    <span class="small-caps">
        <xsl:value-of select="self::*"/>
        <!-- <xsl:apply-templates/> -->
    </span>
</xsl:template>
<xsl:template match="linebreak">
    <br/>
</xsl:template>

<xsl:template match="columnbreak">
    <xsl:element name="div"><xsl:attribute
        name="class">break columnbreak</xsl:attribute><xsl:attribute
        name="id"><xsl:value-of select="@No" />b</xsl:attribute><![CDATA[[]]><xsl:element
        name="a"><xsl:attribute
        name="href">/jod/pdf/JoD<xsl:value-of
        select="@Vol"/>/JoD<xsl:value-of
        select="@Vol"/>_0<xsl:value-of
        select="@PNo"/>.pdf</xsl:attribute><xsl:attribute
        name="target">pdfwin</xsl:attribute>p.<xsl:text
        disable-output-escaping="yes">&amp;nbsp;</xsl:text><xsl:value-of
        select="@No"/>b<![CDATA[]]]><xsl:element
        name="b"><xsl:attribute
        name="class">impdf</xsl:attribute></xsl:element></xsl:element><xsl:element
        name="a"><xsl:attribute
        name="href">https://contentdm.lib.byu.edu/utils/getfile/collection/JournalOfDiscourses3/id/<xsl:value-of
        select="@BYUID"/></xsl:attribute><xsl:attribute
        name="target">pdfwin2</xsl:attribute><xsl:element
        name="b"><xsl:attribute
        name="class">imhbll</xsl:attribute></xsl:element></xsl:element>
    </xsl:element>
</xsl:template>

<xsl:template match="Page">
    <xsl:element name="div"><xsl:attribute
        name="class">break pagebreak</xsl:attribute><xsl:attribute
        name="id"><xsl:value-of select="@No" />a</xsl:attribute><![CDATA[[]]><xsl:element
        name="a"><xsl:attribute
        name="href">/jod/pdf/JoD<xsl:value-of
        select="@Vol"/>/JoD<xsl:value-of
        select="@Vol"/>_0<xsl:value-of
        select="@PNo"/>.pdf</xsl:attribute><xsl:attribute
        name="target">pdfwin</xsl:attribute>p.<xsl:text
        disable-output-escaping="yes">&amp;nbsp;</xsl:text><xsl:value-of
        select="@No"/>a<![CDATA[]]]><xsl:element
        name="b"><xsl:attribute
        name="class">impdf</xsl:attribute></xsl:element></xsl:element><xsl:element
        name="a"><xsl:attribute
        name="href">https://contentdm.lib.byu.edu/utils/getfile/collection/JournalOfDiscourses3/id/<xsl:value-of
        select="@BYUID"/></xsl:attribute><xsl:attribute
        name="target">pdfwin2</xsl:attribute><xsl:element
        name="b"><xsl:attribute
        name="class">imhbll</xsl:attribute></xsl:element></xsl:element>
    </xsl:element>
</xsl:template>

<xsl:template match="hyphen">
<div class="hyphen"><xsl:value-of select="self::*"/></div>
</xsl:template>

<xsl:template match="table">
    <table>
        <xsl:apply-templates/>
    </table>
</xsl:template>

<xsl:template match="tr">
    <tr>
        <xsl:apply-templates/>
    </tr>
</xsl:template>

<xsl:template match="th">
    <th>
        <xsl:apply-templates/>
    </th>
</xsl:template>

<xsl:template match="td">
    <td>
        <xsl:apply-templates/>
    </td>
</xsl:template>

</xsl:stylesheet>

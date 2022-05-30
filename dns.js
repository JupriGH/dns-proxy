// DNS-Proxy v1.00
// http://www-inf.int-evry.fr/~hennequi/CoursDNS/NOTES-COURS_eng/msg.html
// https://www.inacon.de/ph/data/DNS/index.php

// audownload.windowsupdate.nsatc.net

'use strict'

const dgram 	= require('dgram')
const net 		= require('net')
const colors 	= require('colors')

function unixtime( ) 
{
	return Math.round( ( + new Date() ) / 1000 )
}
function getstring( msg, p )
{
	var s = '', n = 0, c = 0

	while ( 1 )
	{
		if ( c++ >= 100 ) {
			console.log( '<sanity>'.red , c )
			process.exit( )
		}

		n = msg[ p ]

		if ( n === 0 )
		{
			p ++
			break
		}
		else if ( n & 0b11000000 ) 
		{
			// pointer
			// http://www.tcpipguide.com/free/t_DNSNameNotationandMessageCompressionTechnique-2.htm			

			var r = ( ( n & 0b111111 ) > 8 ) | msg[ p+1 ]			
			var m = getstring( msg, r )

			s += m.str
			p += 2
			break
		}
		else
		{
			s += ( '.' + msg.slice( p += 1, p += n ).toString() )
		}
	}
	//
	return { str: s, ptr: p } 
}
function getrecord( msg, p, full )
{
	//console.log( '<record>'.red, p,  msg.slice( p ) )
	
	var m = getstring( msg, p ), pttl = undefined

	p = m.ptr
	//
	var r = { 
		name: 	m.str,
		type:  	msg.readUInt16BE( p ),
		class:	msg.readUInt16BE( p +=2 )
	}
	p += 2
	 
	if ( full )
	{
		pttl = p
		//
		r.ttl  = msg.readUInt32BE( p )
		r.size = msg.readUInt16BE( p += 4 )
		
		var o = ( p += 2 )
		
		p += r.size
		
		var d = msg.slice( o, p )

		switch ( r.type )
		{
		case 0x0001: // A = ipv4

			r.rdata = d.join('.')
			break
		
		case 0x0002: // NS
		case 0x0005: // CNAME
		
			var m = getstring( msg, o )
			r.rdata = m.str
			break
			
		default:
			r.rdata = d
		}
	}
	//
	var o = { rec: r, ptr: p, pttl: pttl }
	//console.log( '<record>'.red, o )
	
	return o
}

const full = {
	questions		: false,		
	answers			: true,
	authority 		: true,
	additional 		: true
}

function getresult( msg )
{
	var p = 0, f
	
	var r = {
		id	 : msg.readUInt16BE( p ),
		head : {
			flag			: f = msg.readUInt16BE( p+=2 ),		
			questions		: msg.readUInt16BE( p+=2 ),		
			answers			: msg.readUInt16BE( p+=2 ),
			authority 		: msg.readUInt16BE( p+=2 ),
			additional 		: msg.readUInt16BE( p+=2 )
		},
		flag : { 
			QR		: ( f & 0b1000000000000000 ) >> 15,
			OPCODE	: ( f & 0b0111100000000000 ) >> 11,
			AA		: ( f & 0b0000010000000000 ) >> 10,
			TC		: ( f & 0b0000001000000000 ) >> 9,
			RD		: ( f & 0b0000000100000000 ) >> 8,
			RA		: ( f & 0b0000000010000000 ) >> 7,
			Z		: ( f & 0b0000000001000000 ) >> 6,
			AD		: ( f & 0b0000000000100000 ) >> 5,
			CD		: ( f & 0b0000000000010000 ) >> 4,			
			RCODE	: ( f & 0b0000000000001111 )
		},
		data : {},
		//
		size  : msg.length,
		eof	 : 0,
		pttl : []
	}
	
	var h = r.head

	console.log( 'head'.magenta, JSON.stringify( h ) )
	console.log( 'flag'.magenta, JSON.stringify( r.flag ) )

	p += 2

	//
	Object.keys( full ).map( n => {	

		if ( h[ n ] )
		{
			console.log( n.magenta )
			r.data[ n ] = []
			
			for ( var c = 0; c < h[ n ]; ++c )
			{
				var m = getrecord( msg, p, full[ n ] )
				p = m.ptr

				r.data[ n ].push( m )
				//
				if ( 
					( m.rec.ttl > 0 ) && 
					( m.pttl !== undefined ) 
				)  
					r.pttl.push( { ttl: m.rec.ttl, pttl: m.pttl } )

				console.log( JSON.stringify( m ) ) 
				//console.log( m )
			}
		}
	} )
	
	r.eof = p		
	return r
}

function dnscache( h, msg, t )
{
	return
	//
	if ( h.flag.RCODE ) {
		console.log(' error =>', h.flag.RCODE )
		return
	}
	
	var p = h.data.questions, 
		o = h.data.answers
	
	if ( p && ( p = p[0] ) && o )
	{
		o.some( ( a ) => {
			
			if ( ( a.rec.name ) && ( a.rec.name === p.rec.name ) )
			{
				if ( a.rec.ttl !== undefined )
				{
					console.log( '<cache>'.magenta, 'add:', a.rec, h.pttl )
					cache[ p.rec.name ] = { time: t, pttl: h.pttl, msg: Buffer.from( msg ) }
				}
				return true
			}
		} )
	}
}
function dnstcp( i, srv )
{
	if ( ! query[ i ] ) return

	var con = net.createConnection( { host: srv.address, port: srv.port }, () => {
				
		console.log( '<< connected >>'.cyan )

		var r = query[ i ]
		
		if ( r ) {
			var b = new Buffer.alloc( 2 )
			
			b.writeUInt16BE( r.que.length )
			con.write( b )
			con.write( r.que )
		}
		else con.end()
	} )

	con.on('error', ( ) => console.log( '<< error >>'.cyan ) )
	con.on('close', ( ) => console.log( '<< close >>'.cyan ) )	
	con.on('data', ( buf ) => {
		
		console.log( '<< data >>'.cyan, buf ) 
		
		var t = unixtime( ),
			m = buf.slice(2), h = getresult( m )

		dnsanswer( h.id, m )
		dnscache( h, m, t )
	} )


}
function dnsanswer( i, msg )
{
	if ( ! query[ i ] ) return
	
	var s = query[ i ].dns, c = names[ s ].cli

	console.log( ' to:', c.map( ( o ) => `${o}: ${query[o].info.address}` ) )
		
	c.map( ( o ) => {
		var r = query[ o ].info
		
		//var b = Buffer.from( msg )
		msg.writeUInt16BE( o, 0 )
		server.send( Buffer.from( msg ), r.port, r.address )			
		
		delete query[ o ]
	} )

	delete names[ s ]
}

///////////////////////////////////////////////////////////////////////////////////////////

var query = {}
var names = {}
var cache = {}

const server = dgram.createSocket('udp4')

server.on('listening', () => {
	const a = server.address( )
	console.log(`server listening ${a.address}:${a.port}`)
	/*
	setInterval( () => {
		console.log( '<stats>', 
			'query:'.red, Object.keys( query ).length, 
			'names:'.red, Object.keys( names ), 
			'cache:'.red, Object.keys( cache ).length 
		)
	}, 10000 )
	*/
})
server.on('error', ( err ) => {
	console.log(`server error:\n${err.stack}`)
	server.close()
})
server.on('message', ( msg,info ) => {
	
	var t = unixtime( ),
		h = getresult( msg ), 
		i = h.id
	
	
	//if ( h.size !== h.eof ) console.log('<error>', h.red)
	if ( ! h.data.questions || ! h.data.questions[0] ) {
		console.log( '<< error >>'.red, 'no questions' )
		return
	}

	var s = h.data.questions[0].rec.name

	if ( h.flag.QR === 0 ) // query
	{	
		if ( h.flag.OPCODE !== 0 ) {
			console.log( '<<error>>'.red, 'OPCODE =>', h.flag.OPCODE ) 
			return
		}
		
		console.log( '<query>'.red, s.yellow, `id: ${i} from: ${info.address}:${info.port}` )
		
		// cache
		var c = cache[ s ] 
		if ( c )
		{
			var a = t - c.time, //age
				b = Buffer.from( c.msg )
			
			if ( c.pttl.some( ( o ) => { 
				var f = o.ttl - a 
				if ( f <= 0 ) return true
				b.writeUInt32BE( f, o.pttl )					
			} ) )
			{
				delete cache[ s ]
			}
			else
			{
				// copy id
				b.writeUInt16BE( i, 0 )
				server.send( b, info.port, info.address )

				console.log( '<cache>'.blue, s.yellow, 'id:', i, 'to:', `${info.address}:${info.port}`, 'age:', a )//, 'pttl:', c.pttl )
				//var hh = getresult( b )
				//console.log( hh )
				return
			}
		}
		
		// request timeout
		var n = names[ s ]
		if ( n !== undefined )
		{
			if ( n.ttl < t ) {
				console.log( '<timeout>'.cyan, s, n )
				
				n.cli.map( ( o ) => { delete query[ o ] } )
				delete names[ s ]
			}
		}

		// query
		if ( names[ s ] === undefined )
		{
			names[ s ] = { ttl: t + 5, cli: [ i ] }

			// OpenDNS
			// 208.67.222.222 · 208.67.220.220
			// Opennic
			// 169.239.202.202
			
			console.log( '<resolving>'.green, s.yellow )
			
			server.send( msg, 5353, '208.67.222.222' )
			//server.send( msg, 5353, '208.67.220.220' )
			//server.send( msg, 5353, '169.239.202.202' ) 			
		}
		else if ( query[ i ] === undefined ) 
		{
			names[ s ].cli.push( i )
		}
		//
		if ( query[ i ] === undefined ) 
		{
			query[ i ] = { dns: s, que: msg, info: info }
		}		
	}
	else if ( h.flag.QR === 1 ) // answer
	{
		// answer
		if ( h.flag.TC )
		{
			console.log( '<< truncated >>'.yellow, s.yellow, `from: ${info.address}:${info.port}`  )
			dnstcp( i, info )
		}
		else
		{
			console.log( '<answer>'.blue, s.yellow, `from: ${info.address}:${info.port}` )
			dnsanswer( i, msg )
			dnscache( h, msg, t )
		}
	}
})

server.bind( 53 )

